import { http } from './http';
import type { MessageAttachment } from './conversations';

export async function uploadImage(file: File): Promise<MessageAttachment> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post<MessageAttachment>('/api/media/upload', form, {
    timeout: 30_000,
  });
  return data;
}
