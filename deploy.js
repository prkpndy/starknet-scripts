import { RpcProvider, Account, CallData } from 'starknet';

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
    UNIQUE: '0', // UDC uniqueness flag
};

// ─── Configuration ───────────────────────────────────────────────────────────
// Override via environment variables. ACCOUNT_ADDRESS, ACCOUNT_PRIVATE_KEY,
// and CLASS_HASH are required. CONSTRUCTOR_ARGS is optional.

const CONFIG = {
    rpcUrl: process.env.RPC_URL || DEFAULTS.RPC_URL,
    blockIdentifier: process.env.BLOCK_IDENTIFIER || DEFAULTS.BLOCK_IDENTIFIER,

    accountAddress: process.env.ACCOUNT_ADDRESS,
    accountPrivateKey: process.env.ACCOUNT_PRIVATE_KEY,

    classHash: process.env.CLASS_HASH,                // class hash from declare tx
    constructorArgs: process.env.CONSTRUCTOR_ARGS,    // comma-separated values, e.g. "42" or "0x1,100"
    unique: process.env.UNIQUE || DEFAULTS.UNIQUE,    // "1" for unique UDC deploy, "0" for not unique

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
        ['CLASS_HASH', CONFIG.classHash],
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

async function deploy() {
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

    const constructorCalldata = parseArgs(CONFIG.constructorArgs);

    console.log('Deploying contract...');
    console.log('  classHash:       ', CONFIG.classHash);
    console.log('  constructorArgs: ', constructorCalldata.length > 0 ? constructorCalldata : '(none)');
    console.log('  unique:          ', CONFIG.unique === '1');

    const result = await account.deployContract(
        {
            classHash: CONFIG.classHash,
            constructorCalldata,
            unique: CONFIG.unique === '1',
        },
        { resourceBounds: RESOURCE_BOUNDS }
    );

    console.log('Deploy tx submitted:', result.transaction_hash);

    const receipt = await provider.waitForTransaction(result.transaction_hash, {
        retryInterval: CONFIG.retryInterval,
    });

    // Extract deployed address from receipt events (UDC emits ContractDeployed)
    const deployEvent = receipt.events?.find(e =>
        e.keys?.some(k => k === '0x26b160f10156dea0cac68f6e7e7ec3b9ebc30a37990dfbf88e0a11664ef0d4')
    );
    const contractAddress = deployEvent?.data?.[0] || result.contract_address;

    console.log('Contract deployed:');
    console.log('  address =', contractAddress);
    console.log('  tx      =', result.transaction_hash);
}

deploy().catch((err) => {
    console.error('Failed to deploy contract:', err);
    process.exit(1);
});
