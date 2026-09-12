import http from 'http';

const PORT = 8545;

const block = {
  number: '0x1',
  hash: '0x' + '1'.repeat(64),
  parentHash: '0x' + '0'.repeat(64),
  nonce: '0x0000000000000000',
  sha3Uncles: '0x1dcc4cb82b66476a5b7a0614ab11986e1026c431cd3170f33646413532b88513',
  logsBloom: '0x' + '0'.repeat(512),
  transactionsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
  stateRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
  receiptsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
  miner: '0x0000000000000000000000000000000000000000',
  difficulty: '0x1',
  totalDifficulty: '0x1',
  extraData: '0x',
  size: '0x3e8',
  gasLimit: '0x1c9c380',
  gasUsed: '0x0',
  timestamp: '0x66000000',
  transactions: [],
  uncles: []
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      const requests = Array.isArray(payload) ? payload : [payload];

      const responses = requests.map(item => {
        const id = item.id !== undefined ? item.id : 1;
        const method = item.method;

        let result = null;
        switch (method) {
          case 'eth_chainId':
            result = '0x7a69'; // 31337
            break;
          case 'net_version':
            result = '31337';
            break;
          case 'eth_blockNumber':
            result = '0x1';
            break;
          case 'eth_getBlockByNumber':
            result = block;
            break;
          case 'eth_getBlockByHash':
            result = block;
            break;
          case 'eth_getBalance':
            result = '0x38d7ea4c680000'; // 1000 AUR
            break;
          case 'eth_getCode':
            result = '0x';
            break;
          case 'eth_getTransactionCount':
            result = '0x1';
            break;
          case 'eth_gasPrice':
            result = '0x3b9aca00'; // 1 Gwei
            break;
          case 'eth_estimateGas':
            result = '0x5208'; // 21000
            break;
          case 'eth_call':
            result = '0x';
            break;
          case 'eth_sendTransaction':
          case 'eth_sendRawTransaction':
            result = '0x' + '9'.repeat(64);
            break;
          case 'eth_accounts':
            result = ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
            break;
          default:
            result = '0x0';
            break;
        }

        return {
          jsonrpc: '2.0',
          id: id,
          result: result
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Array.isArray(payload) ? responses : responses[0]));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x0' }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Aurum Local 31337 RPC Server active on http://127.0.0.1:${PORT}`);
});
