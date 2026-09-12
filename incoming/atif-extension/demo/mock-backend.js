/**
 * Standalone Local Mock Backend for /v1/analyze (real shared API contract).
 * Zero-dependency Node.js HTTP server for local testing.
 *
 * Usage:
 *   node demo/mock-backend.js
 *
 * Endpoints:
 *   POST /v1/analyze -> returns an AnalysisReport per the shared contract
 *                        (requestId, requestHash, status, severity, summary,
 *                         fork, simulation, findings, immediateChanges,
 *                         potentialExposure, coverage)
 *   GET /health      -> 200 OK
 */

const http = require('http');

const PORT = process.env.PORT || 3000;

const HEX_64 = /^0x[0-9a-fA-F]{64}$/;

function fakeHash(seed) {
  let hash = '0x';
  let value = seed;
  for (let i = 0; i < 64; i++) {
    value = (value * 31 + i * 7) % 0xffffffff;
    hash += value.toString(16).padStart(8, '0').slice(0, 2);
  }
  return hash.slice(0, 66);
}

function parseChainIdNumber(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^0x[0-9a-fA-F]+$/.test(raw)) return parseInt(raw, 16);
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return parseInt(raw, 10);
  return 1;
}

function buildReport(payload) {
  const { requestId, method, params, chainId, origin } = payload;
  const paramsJson = JSON.stringify(params || []).toLowerCase();

  // Simulated risk profiles (real backend will produce these from actual detection)
  let status = 'complete';
  let severity = 'low';
  let summary = 'Transaction simulated cleanly in an isolated fork. No drain signatures detected.';
  let findings = [
    {
      id: 'verified-destination',
      severity: 'low',
      title: 'Verified Destination',
      description: 'Destination contract source is verified on the block explorer.',
    },
  ];
  let immediateChanges = [];
  let potentialExposure = [];

  const tx = Array.isArray(params) && typeof params[0] === 'object' ? params[0] : {};

  if (method === 'eth_sendTransaction' && tx.value) {
    immediateChanges.push({
      type: 'native_transfer',
      asset: 'AUR',
      from: typeof tx.from === 'string' ? tx.from : undefined,
      to: typeof tx.to === 'string' ? tx.to : undefined,
      amount: tx.value,
    });
  }

  if (method === 'eth_signTypedData_v4') {
    severity = 'high';
    summary = 'EIP-712 permit signature detected: grants token spending allowance without an on-chain transaction.';
    findings = [
      {
        id: 'gasless-permit',
        severity: 'high',
        title: 'Gasless Permit Signature',
        description: 'Permit signatures can be submitted by third parties to move tokens without further consent.',
      },
    ];
    potentialExposure.push({
      kind: 'token_allowance',
      asset: 'Permit allowance',
      description: 'Signed permit may be redeemable by any spender referenced in the typed data.',
    });
  }

  if (paramsJson.includes('dead')) {
    severity = 'medium';
    summary = 'Warning: interaction with a zero/dead address burn destination.';
    findings = [
      {
        id: 'burn-address',
        severity: 'medium',
        title: 'Burn / Dead Address',
        description: 'Assets sent to a 0x...dead destination are permanently irretrievable.',
      },
    ];
  }

  if (paramsJson.includes('drainer')) {
    severity = 'critical';
    summary = 'CRITICAL: known drainer pattern detected — unlimited allowance to a flagged phishing spender.';
    findings = [
      {
        id: 'drainer-pattern',
        severity: 'critical',
        title: 'Token Drainer Detected',
        description: 'The simulation grants setApprovalForAll/unlimited allowance to a known drainer contract.',
      },
    ];
    immediateChanges.push({
      type: 'erc20_approve',
      asset: 'Detective token',
      from: typeof tx.from === 'string' ? tx.from : undefined,
      spender: typeof tx.to === 'string' ? tx.to : undefined,
      amount: 'unlimited',
    });
  }

  if (status !== 'complete') {
    findings = [];
  }

  return {
    requestId: requestId || 'req_demo',
    requestHash: fakeHash(Buffer.from(JSON.stringify(payload)).length),
    status,
    severity,
    summary,

    fork: {
      chainId: parseChainIdNumber(chainId),
      blockNumber: '0x12d4a8f',
      blockHash: fakeHash(1337),
    },

    simulation: {
      mode: method === 'eth_sendTransaction' ? 'transaction' : 'conditional-signature',
      outcome: 'success',
      assumptions: [],
    },

    findings,
    immediateChanges,
    potentialExposure,

    coverage: {
      checked: [
        'balance_solvency',
        'token_allowances',
        'contract_verification',
        'known_drainer_addresses',
        'signature_replay',
      ],
      missing: [],
    },
  };
}

const server = http.createServer((req, res) => {
  // CORS Headers for Extension / DApp access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
    return;
  }

  if (req.url === '/v1/analyze' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);

        console.log(
          `[MockBackend] /v1/analyze requestId=${payload.requestId} method="${payload.method}" origin="${payload.origin}" chainId=${payload.chainId} account=${payload.account}`
        );

        const report = buildReport(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(report));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[MockBackend] Analysis server running at http://localhost:${PORT}`);
  console.log(`[MockBackend] POST /v1/analyze ready (shared AnalysisReport contract).`);
});
