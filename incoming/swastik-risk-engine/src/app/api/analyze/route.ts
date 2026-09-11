import { NextResponse } from 'next/server';
import { defaultRiskEngine, RiskEngine } from '@/engine/riskEngine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const includeDemo = Boolean(body?.includeDemo);

    const engine = includeDemo
      ? new RiskEngine({ includeDemo: true })
      : defaultRiskEngine;

    const report = await engine.analyze(body);
    return NextResponse.json(report, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isValidation = message.includes('Invalid AnalysisRequest');

    return NextResponse.json(
      {
        error: isValidation ? 'Validation Error' : 'Analysis Engine Error',
        message,
      },
      { status: isValidation ? 400 : 500 }
    );
  }
}
