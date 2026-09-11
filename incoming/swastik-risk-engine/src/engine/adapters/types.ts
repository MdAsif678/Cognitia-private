import { type DecodedIntent } from '../../schemas/intent';

export type DecodeSubcallFn = (
  target: string,
  calldata: string,
  value: string,
  caller: string,
  callType: 'call' | 'delegatecall' | 'staticcall',
  depth: number
) => Promise<DecodedIntent>;

export interface RouterAdapterDecodeParams {
  target: string;
  calldata: string;
  value: string;
  caller: string;
  chainId: number;
  depth: number;
  decodeSubcall: DecodeSubcallFn;
}

export interface RouterAdapter {
  readonly id: string;
  readonly name: string;
  readonly isFixtureOnly?: boolean;
  canHandle(target: string, calldata: string, chainId: number): boolean;
  decode(params: RouterAdapterDecodeParams): Promise<DecodedIntent | null>;
}
