import { readFileSync } from 'fs';
import { RpcProvider, Account } from 'starknet';

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS = {
    RPC_URL: 'http://localhost:9944',
    BLOCK_IDENTIFIER: 'latest',
    // L2 gas (execution) — actual price ~8B
    L2_GAS_MAX_AMOUNT: '0x3000000',         // ~50M
    L2_GAS_MAX_PRICE: '0x746a528800',       // ~500B (headroom over ~8B actual)
    // L1 gas — actual price ~51.9T
    L1_GAS_MAX_AMOUNT: '0x100',             // 256
    L1_GAS_MAX_PRICE: '0x3e8d4a510000',     // ~68.7T
    // L1 data gas — actual price ~51K
    L1_DATA_GAS_MAX_AMOUNT: '0x400',        // 1024
    L1_DATA_GAS_MAX_PRICE: '0x20000',       // 131072

    RETRY_INTERVAL: '100',
};

// ─── Configuration ───────────────────────────────────────────────────────────
// Override via environment variables. ACCOUNT_ADDRESS, ACCOUNT_PRIVATE_KEY,
// CONTRACT_PATH, and CASM_PATH are required.

const CONFIG = {
    rpcUrl: process.env.RPC_URL || DEFAULTS.RPC_URL,
    blockIdentifier: process.env.BLOCK_IDENTIFIER || DEFAULTS.BLOCK_IDENTIFIER,

    accountAddress: process.env.ACCOUNT_ADDRESS,
    accountPrivateKey: process.env.ACCOUNT_PRIVATE_KEY,

    contractPath: process.env.CONTRACT_PATH,  // path to Sierra JSON (.contract_class.json)
    casmPath: process.env.CASM_PATH,          // path to CASM JSON (.compiled_contract_class.json)

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
        ['CONTRACT_PATH', CONFIG.contractPath],
        ['CASM_PATH', CONFIG.casmPath],
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
}

async function declare() {
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

    // Read contract artifacts from disk
    const contractClass = JSON.parse(readFileSync(CONFIG.contractPath, 'utf-8'));
    const casmClass = JSON.parse(readFileSync(CONFIG.casmPath, 'utf-8'));

    console.log('Declaring contract...');
    console.log('  Sierra:', CONFIG.contractPath);
    console.log('  CASM:  ', CONFIG.casmPath);

    const { transaction_hash, class_hash } = await account.declare(
        { contract: contractClass, casm: casmClass },
        { resourceBounds: RESOURCE_BOUNDS }
    );

    await provider.waitForTransaction(transaction_hash, {
        retryInterval: CONFIG.retryInterval,
    });

    console.log('Contract declared:');
    console.log('  classHash =', class_hash);
    console.log('  tx        =', transaction_hash);
}

declare().catch((err) => {
    console.error('Failed to declare contract:', err);
    process.exit(1);
});
