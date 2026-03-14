#[starknet::interface]
trait ICounter<TContractState> {
    fn get(self: @TContractState) -> u64;
    fn increment(ref self: TContractState);
    fn set(ref self: TContractState, value: u64);
}

#[starknet::contract]
mod Counter {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        value: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, init_value: u64) {
        self.value.write(init_value);
    }

    #[abi(embed_v0)]
    impl CounterImpl of super::ICounter<ContractState> {
        fn get(self: @ContractState) -> u64 {
            self.value.read()
        }

        fn increment(ref self: ContractState) {
            self.value.write(self.value.read() + 1);
        }

        fn set(ref self: ContractState, value: u64) {
            self.value.write(value);
        }
    }
}
