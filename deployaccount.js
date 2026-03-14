import {
    RpcProvider,
    Account,
    ec,
    hash,
    CallData,
    Contract,
    stark,
} from 'starknet';

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS = {
    RPC_URL: 'http://localhost:9944',
    BLOCK_IDENTIFIER: 'pre_confirmed',
    FEE_TOKEN_ADDRESS: '0x4defde0f0a7e7734ca8d3f2c9eb8bebf7cc21a23fae13d3e9b5d697f60465bc',
    ACCOUNT_CLASS_HASH: '0xe81f6009f96661c969f14c40d8b453cc40fc6c674607a61c23bb3563709e2a',
    RESOURCE_BOUNDS_MAX_AMOUNT: '0x09ba4b0',
    RESOURCE_BOUNDS_MAX_PRICE: '0x0186a0',
    RETRY_INTERVAL: '100',
};

// ─── Configuration ───────────────────────────────────────────────────────────
// Override via environment variables. FUNDER_ADDRESS, FUNDER_PRIVATE_KEY, and
// TRANSFER_AMOUNT are required.

const CONFIG = {
    rpcUrl: process.env.RPC_URL || DEFAULTS.RPC_URL,
    blockIdentifier: process.env.BLOCK_IDENTIFIER || DEFAULTS.BLOCK_IDENTIFIER,

    funderAddress: process.env.FUNDER_ADDRESS,
    funderPrivateKey: process.env.FUNDER_PRIVATE_KEY,

    feeTokenAddress: process.env.FEE_TOKEN_ADDRESS || DEFAULTS.FEE_TOKEN_ADDRESS,
    accountClassHash: process.env.ACCOUNT_CLASS_HASH || DEFAULTS.ACCOUNT_CLASS_HASH,

    transferAmount: process.env.TRANSFER_AMOUNT ? BigInt(process.env.TRANSFER_AMOUNT) : undefined,

    resourceBoundsMaxAmount: BigInt(process.env.RESOURCE_BOUNDS_MAX_AMOUNT || DEFAULTS.RESOURCE_BOUNDS_MAX_AMOUNT),
    resourceBoundsMaxPrice: BigInt(process.env.RESOURCE_BOUNDS_MAX_PRICE || DEFAULTS.RESOURCE_BOUNDS_MAX_PRICE),

    retryInterval: Number(process.env.RETRY_INTERVAL || DEFAULTS.RETRY_INTERVAL),
};

const RESOURCE_BOUNDS = {
    l2_gas: { max_amount: CONFIG.resourceBoundsMaxAmount, max_price_per_unit: CONFIG.resourceBoundsMaxPrice },
    l1_gas: { max_amount: CONFIG.resourceBoundsMaxAmount, max_price_per_unit: CONFIG.resourceBoundsMaxPrice },
    l1_data_gas: { max_amount: CONFIG.resourceBoundsMaxAmount, max_price_per_unit: CONFIG.resourceBoundsMaxPrice },
};

// ─── Constants ───────────────────────────────────────────────────────────────

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
        name: 'transfer',
        stateMutability: 'external',
        inputs: [
            {
                name: 'recipient',
                type: 'core::starknet::contract_address::ContractAddress',
            },
            { name: 'amount', type: 'core::integer::u256' },
        ],
        outputs: [{ type: 'core::bool' }],
    },
];

// ─── Main ────────────────────────────────────────────────────────────────────

function validateConfig() {
    const required = [
        ['FUNDER_ADDRESS', CONFIG.funderAddress],
        ['FUNDER_PRIVATE_KEY', CONFIG.funderPrivateKey],
        ['TRANSFER_AMOUNT', CONFIG.transferAmount],
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
}

async function deployAccount() {
    validateConfig();
    const provider = new RpcProvider({
        nodeUrl: CONFIG.rpcUrl,
        blockIdentifier: CONFIG.blockIdentifier,
    });

    const funderAccount = new Account({
        provider,
        address: CONFIG.funderAddress,
        signer: CONFIG.funderPrivateKey,
        cairoVersion: '1',
        transactionVersion: '0x3',
    });

    const feeTokenContract = new Contract({
        abi: ERC20_ABI,
        address: CONFIG.feeTokenAddress,
        providerOrAccount: provider,
    });

    // Generate new account keypair
    const privateKey = stark.randomAddress();
    const publicKey = ec.starkCurve.getStarkKey(privateKey);

    // Calculate future address of the account
    const constructorCalldata = CallData.compile({ publicKey });
    const accountAddress = hash.calculateContractAddressFromHash(
        publicKey,
        CONFIG.accountClassHash,
        constructorCalldata,
        0
    );

    console.log('New OZ account:');
    console.log('  privateKey =', privateKey);
    console.log('  publicKey  =', publicKey);
    console.log('  address    =', accountAddress);

    // Fund the new account
    const transferCalldata = feeTokenContract.populate('transfer', {
        recipient: accountAddress,
        amount: { low: CONFIG.transferAmount, high: 0 },
    });
    const transferResult = await funderAccount.execute(transferCalldata, {
        blockIdentifier: CONFIG.blockIdentifier,
        resourceBounds: RESOURCE_BOUNDS,
    });
    await provider.waitForTransaction(transferResult.transaction_hash, {
        retryInterval: CONFIG.retryInterval,
    });
    console.log('Funded new account, tx:', transferResult.transaction_hash);

    // Deploy the account
    const newAccount = new Account({
        provider,
        address: accountAddress,
        signer: privateKey,
    });

    const { transaction_hash, contract_address } =
        await newAccount.deployAccount({
            classHash: CONFIG.accountClassHash,
            constructorCalldata: constructorCalldata,
            addressSalt: publicKey,
        }, { resourceBounds: RESOURCE_BOUNDS });
    await provider.waitForTransaction(transaction_hash, {
        retryInterval: CONFIG.retryInterval,
    });
    console.log('Account deployed:', contract_address);
}

deployAccount().catch((err) => {
    console.error('Failed to deploy account:', err);
    process.exit(1);
});
