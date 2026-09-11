import { MAX_UINT256 } from '../engine/deterministicRules';

export interface FormattedTokenAmount {
  raw: string;
  formatted: string;
  symbol: string;
  decimals?: number;
  isVerifiedToken: boolean;
  unverifiedNote?: string;
  isUnlimited: boolean;
  isRevocation: boolean;
}

const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number; name: string }> = {
  // Ethereum Mainnet
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6, name: 'Tether USD' },
  '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', decimals: 18, name: 'Dai Stablecoin' },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
  '0x0000000000000000000000000000000000000000': { symbol: 'ETH', decimals: 18, name: 'Ether' },
  native: { symbol: 'ETH', decimals: 18, name: 'Ether' },
};

/**
 * Formats a raw token amount cleanly while preserving raw units.
 * Strictly avoids guessing decimals or symbols for unknown tokens.
 */
export function formatTokenAmount(
  rawAmount: string | bigint | number | undefined | null,
  tokenAddress?: string
): FormattedTokenAmount {
  if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
    return {
      raw: '0',
      formatted: '0',
      symbol: 'units',
      isVerifiedToken: false,
      isUnlimited: false,
      isRevocation: true,
    };
  }

  const rawStr = typeof rawAmount === 'bigint' ? rawAmount.toString() : String(rawAmount);

  let valBigInt: bigint | null = null;
  try {
    valBigInt = BigInt(rawStr);
  } catch {
    return {
      raw: rawStr,
      formatted: rawStr,
      symbol: 'units',
      isVerifiedToken: false,
      isUnlimited: false,
      isRevocation: false,
      unverifiedNote: 'Non-numeric raw amount',
    };
  }

  const isUnlimited = valBigInt === MAX_UINT256;
  const isRevocation = valBigInt === 0n;

  if (isUnlimited) {
    return {
      raw: rawStr,
      formatted: 'Unlimited (2^256 - 1)',
      symbol: 'MAX_UINT256',
      isVerifiedToken: true,
      isUnlimited: true,
      isRevocation: false,
    };
  }

  if (isRevocation) {
    return {
      raw: '0',
      formatted: '0 (Revocation / None)',
      symbol: 'units',
      isVerifiedToken: true,
      isUnlimited: false,
      isRevocation: true,
    };
  }

  const tokenKey = (tokenAddress || '').toLowerCase();
  const known = KNOWN_TOKENS[tokenKey];

  if (known) {
    const decimals = known.decimals;
    const isNegative = valBigInt < 0n;
    const absVal = isNegative ? -valBigInt : valBigInt;

    const base = 10n ** BigInt(decimals);
    const integerPart = absVal / base;
    const remainder = absVal % base;

    let fracStr = remainder.toString().padStart(decimals, '0');
    // Trim trailing zeros down to at most 4 digits or stop
    fracStr = fracStr.replace(/0+$/, '');
    if (fracStr.length > 4) {
      fracStr = fracStr.slice(0, 4);
    }

    const formattedNum = fracStr.length > 0 ? `${integerPart}.${fracStr}` : integerPart.toString();
    const sign = isNegative ? '-' : '';

    return {
      raw: rawStr,
      formatted: `${sign}${formattedNum} ${known.symbol}`,
      symbol: known.symbol,
      decimals: known.decimals,
      isVerifiedToken: true,
      isUnlimited: false,
      isRevocation: false,
    };
  }

  // Unknown token: Strictly preserve raw amount without guessing decimals/symbols!
  return {
    raw: rawStr,
    formatted: `${rawStr} base units`,
    symbol: 'unverified',
    isVerifiedToken: false,
    unverifiedNote: 'Decimals and symbol unverified; preserving exact base units',
    isUnlimited: false,
    isRevocation: false,
  };
}
