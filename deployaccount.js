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
    BLOCK_IDENTIFIER: 'latest',
    FEE_TOKEN_ADDRESS: '0x04718f5a0Fc34cC1AF16A1cdee98fFB20C31f5cD61D6Ab07201858f4287c938D',
    ACCOUNT_TYPE: 'oz', // 'oz' or 'argent'
    OZ_CLASS_HASH: '0xe81f6009f96661c969f14c40d8b453cc40fc6c674607a61c23bb3563709e2a',
    ARGENT_CLASS_HASH: '0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f',
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
// Override via environment variables. FUNDER_ADDRESS, FUNDER_PRIVATE_KEY, and
// TRANSFER_AMOUNT are required.

const CONFIG = {
    rpcUrl: process.env.RPC_URL || DEFAULTS.RPC_URL,
    blockIdentifier: process.env.BLOCK_IDENTIFIER || DEFAULTS.BLOCK_IDENTIFIER,

    funderAddress: process.env.FUNDER_ADDRESS,
    funderPrivateKey: process.env.FUNDER_PRIVATE_KEY,

    feeTokenAddress: process.env.FEE_TOKEN_ADDRESS || DEFAULTS.FEE_TOKEN_ADDRESS,
    accountType: (process.env.ACCOUNT_TYPE || DEFAULTS.ACCOUNT_TYPE).toLowerCase(),
    ozClassHash: process.env.OZ_CLASS_HASH || DEFAULTS.OZ_CLASS_HASH,
    argentClassHash: process.env.ARGENT_CLASS_HASH || DEFAULTS.ARGENT_CLASS_HASH,

    transferAmount: process.env.TRANSFER_AMOUNT ? BigInt(process.env.TRANSFER_AMOUNT) : undefined,

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

    const isArgent = CONFIG.accountType === 'argent';
    const classHash = isArgent ? CONFIG.argentClassHash : CONFIG.ozClassHash;

    // Build constructor calldata based on account type
    let constructorCalldata;
    if (isArgent) {
        // Argent: constructor(owner: Signer, guardian: Option<Signer>)
        // Signer::Starknet(StarknetSigner { pubkey }) = [0, pubkey]
        // Option::None for guardian = [1]
        constructorCalldata = CallData.compile([
            '0',       // Signer variant index: Starknet = 0
            publicKey, // StarknetSigner.pubkey
            '1',       // Option variant index: None = 1
        ]);
    } else {
        // OZ: constructor(public_key: felt252)
        constructorCalldata = CallData.compile({ publicKey });
    }

    // Calculate future address of the account
    const accountAddress = hash.calculateContractAddressFromHash(
        publicKey,
        classHash,
        constructorCalldata,
        0
    );

    console.log(`New ${isArgent ? 'Argent' : 'OZ'} account:`);
    console.log('  privateKey =', privateKey);
    console.log('  publicKey  =', publicKey);
    console.log('  address    =', accountAddress);

    // Fund the new account
    const transferCalldata = feeTokenContract.populate('transfer', {
        recipient: accountAddress,
        amount: { low: CONFIG.transferAmount, high: 0 },
    });
    const nonce = await provider.getNonceForAddress(CONFIG.funderAddress, 'latest');
    console.log('Funder nonce:', nonce);
    const transferResult = await funderAccount.execute(transferCalldata, {
        resourceBounds: RESOURCE_BOUNDS,
        nonce,
    });
    await provider.waitForTransaction(transferResult.transaction_hash, {
        retryInterval: CONFIG.retryInterval,
        successStates: ['ACCEPTED_ON_L2', 'ACCEPTED_ON_L1'],
    });
    console.log('Funded new account, tx:', transferResult.transaction_hash);

    // Wait for balance to be available
    let balance = 0n;
    while (balance === 0n) {
        const result = await feeTokenContract.balanceOf(accountAddress);
        balance = BigInt(result);
        if (balance === 0n) {
            console.log('Waiting for balance to be reflected...');
            await new Promise(r => setTimeout(r, CONFIG.retryInterval));
        }
    }
    console.log('New account balance:', balance.toString());

    // Deploy the account
    const newAccount = new Account({
        provider,
        address: accountAddress,
        signer: privateKey,
        cairoVersion: '1',
        transactionVersion: '0x3',
    });

    // Deploy bounds — needs at least 560K L2 gas, plus L1 gas/data
    // Ensure TRANSFER_AMOUNT is high enough to cover worst case (~2 STRK)
    const deployResourceBounds = {
        l2_gas: { max_amount: BigInt('0x100000'), max_price_per_unit: BigInt('0x746a528800') },
        l1_gas: { max_amount: BigInt(1), max_price_per_unit: BigInt('0x2f132b6a8f98') },
        l1_data_gas: { max_amount: BigInt('0x100'), max_price_per_unit: BigInt('0xca2f') },
    };

    const { transaction_hash, contract_address } =
        await newAccount.deployAccount({
            classHash,
            constructorCalldata: constructorCalldata,
            addressSalt: publicKey,
        }, { resourceBounds: deployResourceBounds });
    await provider.waitForTransaction(transaction_hash, {
        retryInterval: CONFIG.retryInterval,
    });
    console.log('Account deployed:', contract_address);
}

deployAccount().catch((err) => {
    console.error('Failed to deploy account:', err);
    process.exit(1);
});
