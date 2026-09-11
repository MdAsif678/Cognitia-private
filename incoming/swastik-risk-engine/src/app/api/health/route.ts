import { NextResponse } from 'next/server';
import { defaultAnvilWorker } from '@/simulator/anvilWorker';
import { SUPPORTED_CHAINS, DEFAULT_CHAIN_ID } from '@/config/chains';

export async function GET() {
  const isAnvilInstalled = await defaultAnvilWorker.isAnvilInstalled();

  return NextResponse.json({
    status: 'online',
    version: '1.0.0',
    defaultChainId: DEFAULT_CHAIN_ID,
    supportedChains: Object.keys(SUPPORTED_CHAINS).map(Number),
    simulator: {
      anvilInstalled: isAnvilInstalled,
      anvilRpcUrl: defaultAnvilWorker.getRpcUrl(),
      fallbackAvailable: true,
    },
    safetyPolicy: {
      privateKeysRequired: false,
      publicBroadcasting: false,
      safeLabelingForbidden: true,
    },
  });
}
