import { z } from 'zod';

/** RPC methods the platform sends to devices (ThingsBoard one-way RPC). */
export const RPC_METHODS = ['setState', 'setSetpoint'] as const;
export const RpcMethodSchema = z.enum(RPC_METHODS);
export type RpcMethod = z.infer<typeof RpcMethodSchema>;

export const SetStateParamsSchema = z.object({
  state: z.union([z.literal(0), z.literal(1)]),
});
export type SetStateParams = z.infer<typeof SetStateParamsSchema>;

export const SetSetpointParamsSchema = z.object({
  setpoint_c: z.number().min(16).max(30),
});
export type SetSetpointParams = z.infer<typeof SetSetpointParamsSchema>;

export const RpcRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('setState'), params: SetStateParamsSchema }),
  z.object({ method: z.literal('setSetpoint'), params: SetSetpointParamsSchema }),
]);
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcResponseSchema = z.object({
  ok: z.boolean(),
  state: z.number().optional(),
  setpoint_c: z.number().optional(),
  error: z.string().optional(),
});
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

/** Device types that accept each method. */
export const RPC_SUPPORT: Record<RpcMethod, readonly string[]> = {
  setState: ['light', 'ac', 'plug'],
  setSetpoint: ['ac'],
};

export const RPC_TIMEOUT_MS = 5_000;
