import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { chat, type ChatEvent } from '../pi.ts';
import { checkInput, filterOutput, redactPII, StreamRedactor } from '../security/guard.ts';
import type { Citation } from '../rag/service.ts';
import { AGENTS, isAgentId, type AgentId } from '../agents/roles.ts';
import { routeMessage } from '../agents/router.ts';
import {
  addMessage,
  createConversation,
  getConversation,
  listMessages,
  type Conversation,
} from '../conversations/service.ts';

export interface ChatBody {
  message?: string;
  conversationId?: string;
  sessionId?: string;
  stream?: boolean;
  agent?: string;
  reasoning?: string;
}

function mergeCitations(target: Citation[], incoming: Citation[] | undefined): void {
  if (!incoming?.length) return;
  for (const citation of incoming) {
    if (!target.some((existing) => existing.chunk_id === citation.chunk_id)) target.push(citation);
  }
}

function conversationPayload(conversation: Conversation) {
  return {
    type: 'conversation' as const,
    conversation_id: conversation.conversation_id,
    title: conversation.title,
    pinned: conversation.pinned,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
  };
}

export async function handleChat(
  c: Context,
  body: ChatBody,
  preset?: Conversation,
): Promise<Response> {
  const message = body.message?.trim();
  if (!message) return c.json({ error: 'message 不能为空' }, 400);
  const reasoning =
    body.reasoning === 'low' || body.reasoning === 'medium' || body.reasoning === 'high'
      ? body.reasoning
      : undefined;

  const guard = checkInput(message);
  if (guard.blocked) {
    return c.json({ code: 'SECURITY_BLOCKED', message: guard.reason, matches: guard.matches }, 400);
  }
  const redacted = redactPII(message);
  const safeMessage = redacted.text;
  const securityInfo = { input_redactions: redacted.hits };

  let conversation = preset;
  if (!conversation) {
    const explicitId = body.conversationId?.trim();
    if (explicitId) {
      conversation = getConversation(explicitId);
      if (!conversation) return c.json({ error: '会话不存在' }, 404);
    } else {
      conversation = createConversation();
    }
  }

  const userMessage = addMessage(conversation.conversation_id, {
    role: 'user',
    content: message,
    msgType: 'text',
  });
  conversation = getConversation(conversation.conversation_id) ?? conversation;

  const history = listMessages(conversation.conversation_id, { limit: 24 })
    .messages.filter((item) => item.message_id !== userMessage.message_id)
    .map((item) => ({ role: item.role, content: item.content, created_at: item.created_at }));

  const decision: { agent: AgentId; reason: string } = isAgentId(body.agent)
    ? { agent: body.agent, reason: '用户指定' }
    : await routeMessage(safeMessage);

  const conversationInfo = conversationPayload(conversation);

  if (body.stream) {
    return streamSSE(c, async (stream) => {
      const redactor = new StreamRedactor();
      const citations: Citation[] = [];
      let assistantText = '';
      let saved = false;

      const persistAssistant = (text: string) => {
        if (saved) return;
        const filtered = filterOutput(text).text;
        if (!filtered.trim()) return;
        saved = true;
        try {
          addMessage(conversation!.conversation_id, {
            role: 'assistant',
            content: filtered,
            agent: AGENTS[decision.agent].name,
            citations,
          });
        } catch {
          // 流式期间会话可能被删除，丢弃本次回复
        }
      };

      // SSE 写入串行化并在返回前冲刷，避免短回复被截断
      let writeChain: Promise<void> = Promise.resolve();
      const emit = (event: string, payload: unknown) => {
        writeChain = writeChain
          .then(() => stream.writeSSE({ event, data: JSON.stringify(payload) }))
          .catch(() => undefined);
      };

      try {
        await stream.writeSSE({ event: 'conversation', data: JSON.stringify(conversationInfo) });
        await stream.writeSSE({
          event: 'route',
          data: JSON.stringify({
            type: 'route',
            agent: decision.agent,
            agent_name: AGENTS[decision.agent].name,
            reason: decision.reason,
          }),
        });
        if (redacted.hits.length > 0) {
          await stream.writeSSE({
            event: 'security',
            data: JSON.stringify({ type: 'security', ...securityInfo }),
          });
        }
        await chat(
          conversation!.conversation_id,
          safeMessage,
          (event: ChatEvent) => {
            if (event.type === 'delta' && event.text) {
              assistantText += event.text;
              const filtered = redactor.push(event.text);
              if (filtered) emit('delta', { ...event, text: filtered });
              return;
            }
            if (event.type === 'citations') {
              mergeCitations(citations, event.citations);
              emit(event.type, event);
              return;
            }
            if (event.type === 'done') {
              const full = filterOutput(event.text ?? assistantText).text;
              const tail = redactor.flush();
              if (tail) emit('delta', { type: 'delta', text: tail });
              persistAssistant(full);
              emit('done', { type: 'done', text: full });
              return;
            }
            if (event.type === 'error') persistAssistant(assistantText);
            emit(event.type, event);
          },
          c.req.raw.signal,
          decision.agent,
          { reasoning, history },
        );
      } catch (e) {
        persistAssistant(assistantText);
        emit('error', { type: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        await writeChain;
      }
    });
  }

  try {
    const citations: Citation[] = [];
    const raw = await chat(
      conversation.conversation_id,
      safeMessage,
      (event) => {
        if (event.citations) mergeCitations(citations, event.citations);
      },
      c.req.raw.signal,
      decision.agent,
      { reasoning, history },
    );
    const filtered = filterOutput(raw);
    if (filtered.text.trim()) {
      try {
        addMessage(conversation.conversation_id, {
          role: 'assistant',
          content: filtered.text,
          agent: AGENTS[decision.agent].name,
          citations,
        });
      } catch {
        // 会话在生成期间被删除，丢弃本次回复
      }
    }
    return c.json({
      sessionId: conversation.conversation_id,
      conversation_id: conversation.conversation_id,
      conversation_title: conversation.title,
      agent: decision.agent,
      agent_name: AGENTS[decision.agent].name,
      route_reason: decision.reason,
      reply: filtered.text,
      citations,
      security: { ...securityInfo, output_redactions: filtered.hits },
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
}
