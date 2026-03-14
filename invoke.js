import { RpcProvider, Account, Contract } from 'starknet';

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS = {
    RPC_URL: 'http://localhost:9944',
    BLOCK_IDENTIFIER: 'latest',
    // L2 gas — actual price ~8B
    L2_GAS_MAX_AMOUNT: '0x200000',
    L2_GAS_MAX_PRICE: '0x746a528800',
    // L1 gas — actual price ~51.9T
    L1_GAS_MAX_AMOUNT: '0x100',
    L1_GAS_MAX_PRICE: '0x3e8d4a510000',
    // L1 data gas — actual price ~51K
    L1_DATA_GAS_MAX_AMOUNT: '0x400',
    L1_DATA_GAS_MAX_PRICE: '0x20000',

    RETRY_INTERVAL: '5000',
};

// ─── Configuration ───────────────────────────────────────────────────────────
// Override via environment variables. ACCOUNT_ADDRESS, ACCOUNT_PRIVATE_KEY,
// CONTRACT_ADDRESS, FUNCTION_NAME are required. FUNCTION_ARGS is optional.

const CONFIG = {
    rpcUrl: process.env.RPC_URL || DEFAULTS.RPC_URL,
    blockIdentifier: process.env.BLOCK_IDENTIFIER || DEFAULTS.BLOCK_IDENTIFIER,

    accountAddress: process.env.ACCOUNT_ADDRESS,
    accountPrivateKey: process.env.ACCOUNT_PRIVATE_KEY,

    contractAddress: process.env.CONTRACT_ADDRESS,
    functionName: process.env.FUNCTION_NAME,
    functionArgs: process.env.FUNCTION_ARGS, // comma-separated values, e.g. "42" or "0x1,100"

    retryInterval: Number(process.env.RETRY_INTERVAL || DEFAULTS.RETRY_INTERVAL),
};

const RESOURCE_BOUNDS = {
    l2_gas: {
        max_amount: BigInt(process.env.L2_GAS_MAX_AMOUNT || DEFAULTS.L2_GAS_MAX_AMOUNT),
        max_price_per_unit: BigInt(process.env.L2_GAS_MAX_PRICE || DEFAULTS.L2_GAS_MAX_PRICE),
    },
    l1_gas: {
        max_amount: BigInt(process.env.L1_GAS_MAX_AMOUNT || DEFAULTS.L1_GAS_MAX_AMOUNT),
        max_price_per_unit: BigInt(process.env.L1_GAS_MAX_PRICE || DEFAULTS.L1_GAS_MAX_PRICE),
    },
    l1_data_gas: {
        max_amount: BigInt(process.env.L1_DATA_GAS_MAX_AMOUNT || DEFAULTS.L1_DATA_GAS_MAX_AMOUNT),
        max_price_per_unit: BigInt(process.env.L1_DATA_GAS_MAX_PRICE || DEFAULTS.L1_DATA_GAS_MAX_PRICE),
    },
};

// ─── Main ────────────────────────────────────────────────────────────────────

function validateConfig() {
    const required = [
        ['ACCOUNT_ADDRESS', CONFIG.accountAddress],
        ['ACCOUNT_PRIVATE_KEY', CONFIG.accountPrivateKey],
        ['CONTRACT_ADDRESS', CONFIG.contractAddress],
        ['FUNCTION_NAME', CONFIG.functionName],
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
}

function parseArgs(argsStr) {
    if (!argsStr) return [];
    return argsStr.split(',').map((arg) => arg.trim());
}

async function invoke() {
    validateConfig();

    const provider = new RpcProvider({
        nodeUrl: CONFIG.rpcUrl,
        blockIdentifier: CONFIG.blockIdentifier,
    });

    const account = new Account({
        provider,
        address: CONFIG.accountAddress,
        signer: CONFIG.accountPrivateKey,
        cairoVersion: '1',
        transactionVersion: '0x3',
    });

    const args = parseArgs(CONFIG.functionArgs);

    console.log('Invoking contract...');
    console.log('  contract:', CONFIG.contractAddress);
    console.log('  function:', CONFIG.functionName);
    console.log('  args:    ', args.length > 0 ? args : '(none)');

    const { transaction_hash } = await account.execute({
        contractAddress: CONFIG.contractAddress,
        entrypoint: CONFIG.functionName,
        calldata: args,
    }, { resourceBounds: RESOURCE_BOUNDS });

    await provider.waitForTransaction(transaction_hash, {
        retryInterval: CONFIG.retryInterval,
    });

    console.log('Invoke successful:');
    console.log('  tx =', transaction_hash);
}

invoke().catch((err) => {
    console.error('Failed to invoke contract:', err);
    process.exit(1);
});
