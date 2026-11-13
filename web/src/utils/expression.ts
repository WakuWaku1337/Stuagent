import {
  compileExpression,
  evaluateNode,
  parseExpression,
  serializeExpression,
  collectVariables,
  substituteVariables,
  substituteFunctions,
  isBuiltinFunction,
  ExpressionError,
} from '../../../shared/expression';
import type {
  ExprNode,
  FunctionDefinition,
  ExpressionEvaluator,
} from '../../../shared/expression';

export {
  compileExpression,
  evaluateNode,
  parseExpression,
  serializeExpression,
  collectVariables,
  substituteVariables,
  substituteFunctions,
  isBuiltinFunction,
  ExpressionError,
};
export type { ExprNode, FunctionDefinition, ExpressionEvaluator };

export function evaluateFunction(expression: string, value: number): number {
  return compileExpression(expression)(value);
}
