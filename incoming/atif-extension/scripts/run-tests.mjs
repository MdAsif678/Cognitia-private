import { createServer } from 'vite';

// Minimal browser environment polyfill for Node.js
if (typeof globalThis.window === 'undefined') {
  const eventListeners = {};
  globalThis.window = {
    location: { origin: 'http://localhost:3000' },
    addEventListener: (event, handler) => {
      eventListeners[event] = eventListeners[event] || [];
      eventListeners[event].push(handler);
    },
    removeEventListener: (event, handler) => {
      if (eventListeners[event]) {
        eventListeners[event] = eventListeners[event].filter((h) => h !== handler);
      }
    },
    dispatchEvent: (event) => {
      const handlers = eventListeners[event.type] || [];
      handlers.forEach((h) => h(event));
      return true;
    },
    postMessage: (data, targetOrigin) => {
      const handlers = eventListeners['message'] || [];
      const msgEvent = {
        data,
        origin: targetOrigin || 'http://localhost:3000',
        source: globalThis.window,
      };
      handlers.forEach((h) => h(msgEvent));
    },
  };
  globalThis.Event = class Event {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.CustomEvent = class CustomEvent extends globalThis.Event {
    constructor(type, options = {}) {
      super(type);
      this.detail = options.detail;
    }
  };
}

async function run() {
  console.log('--- Starting Automated Test Suites via Vite SSR Loader ---');
  const server = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    const interceptorMod = await server.ssrLoadModule('./tests/interceptor.test.ts');
    const bridgeMod = await server.ssrLoadModule('./tests/bridge.test.ts');
    const analyzerMod = await server.ssrLoadModule('./tests/analyzer.test.ts');
    const riskReportMod = await server.ssrLoadModule('./tests/riskReport.test.ts');

    console.log('\n[Suite 1] Page-Context Interceptor Tests:');
    const r1 = await interceptorMod.runAllTests();
    r1.forEach((t) => console.log(`  ${t.passed ? '✓' : '✗'} ${t.name}${t.error ? ' - ' + t.error : ''}`));

    console.log('\n[Suite 2] Content Script Bridge Tests:');
    const r2 = await bridgeMod.runBridgeTests();
    r2.forEach((t) => console.log(`  ${t.passed ? '✓' : '✗'} ${t.name}${t.error ? ' - ' + t.error : ''}`));

    console.log('\n[Suite 3] Analysis Client Tests:');
    const r3 = await analyzerMod.runAnalyzerTests();
    r3.forEach((t) => console.log(`  ${t.passed ? '✓' : '✗'} ${t.name}${t.error ? ' - ' + t.error : ''}`));

    console.log('\n[Suite 4] RiskReport UI & Fixtures Tests:');
    const r4 = await riskReportMod.runRiskReportTests();
    r4.forEach((t) => console.log(`  ${t.passed ? '✓' : '✗'} ${t.name}${t.error ? ' - ' + t.error : ''}`));

    const regressionMod = await server.ssrLoadModule('./tests/regressions.test.ts');
    const r5 = await regressionMod.runRegressionTests();
    r5.forEach(t => console.log(`  ${t.passed ? '✓' : '✗'} ${t.name}${t.error ? ' - ' + t.error : ''}`));
    const all = [...r1, ...r2, ...r3, ...r4, ...r5];
    const passed = all.filter((t) => t.passed).length;
    const failed = all.length - passed;

    console.log(`\n==================================================`);
    console.log(`Summary: ${passed}/${all.length} passed (${failed} failed)`);
    console.log(`==================================================\n`);

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

run();
