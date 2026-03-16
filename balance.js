import { RpcProvider, Contract } from 'starknet';

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS = {
    RPC_URL: 'http://localhost:9944',
    FEE_TOKEN_ADDRESS: '0x04718f5a0Fc34cC1AF16A1cdee98fFB20C31f5cD61D6Ab07201858f4287c938D',
};

// ─── Configuration ───────────────────────────────────────────────────────────
// Override via environment variables. ACCOUNT_ADDRESS is required.

const CONFIG = {
    rpcUrl: process.env.RPC_URL || DEFAULTS.RPC_URL,
    feeTokenAddress: process.env.FEE_TOKEN_ADDRESS || DEFAULTS.FEE_TOKEN_ADDRESS,
    accountAddress: process.env.ACCOUNT_ADDRESS,
};

// ─── Constants ──────────────────────────────────────────────────────────────

const ERC20_ABI = [
    {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [
            {
                name: 'account',
                type: 'core::starknet::contract_address::ContractAddress',
            },
        ],
        outputs: [{ type: 'core::integer::u256' }],
    },
    {
        type: 'function',
        name: 'decimals',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'core::integer::u8' }],
    },
    {
        type: 'function',
        name: 'symbol',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ type: 'core::felt252' }],
    },
];

// ─── Main ────────────────────────────────────────────────────────────────────

function validateConfig() {
    if (!CONFIG.accountAddress) {
        console.error('Missing required environment variable: ACCOUNT_ADDRESS');
        process.exit(1);
    }
}

async function getBalance() {
    validateConfig();

    const provider = new RpcProvider({ nodeUrl: CONFIG.rpcUrl });
    const feeToken = new Contract({ abi: ERC20_ABI, address: CONFIG.feeTokenAddress, providerOrAccount: provider });

    const [balance, decimals, symbol] = await Promise.all([
        feeToken.balanceOf(CONFIG.accountAddress).then(r => BigInt(r)),
        feeToken.decimals().then(r => Number(r)),
        feeToken.symbol().then(r => r),
    ]);

    const divisor = 10n ** BigInt(decimals);
    const whole = balance / divisor;
    const fractional = balance % divisor;
    const formatted = `${whole}.${fractional.toString().padStart(decimals, '0')}`;

    console.log('Account:', CONFIG.accountAddress);
    console.log('Token:  ', CONFIG.feeTokenAddress, `(${symbol}, with decimals=${decimals})`);
    console.log('Balance:', balance.toString(), `(${formatted} ${symbol})`);
}

getBalance().catch((err) => {
    console.error('Failed to get balance:', err);
    process.exit(1);
});
