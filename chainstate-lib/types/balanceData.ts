import { BlockRef } from "./blockData";

// this interface is used for deposits to a contract and to a users personal balance (safe)
export interface Deposit {
    from: string; // the account id that the funds are coming from
    id: string; // the initial transaction id (hive tx id if the deposit is from hive, vsc tx id if the deposit is a transfer from another contract)
    orig_balance: number; // the original amount deposited
    active_balance: number; // the current amount of funds available for withdrawal
    created_at: Date;
    last_interacted_at: Date;
    outputs: Array<DepositDrain>; // when balance leaves the deposit, either via internal vsc transfer or hive withdraw request, the tx id is added here
    inputs: Array<DepositDrain>; // when balance not directly comes from a hive tx, but an internal transfer it is a sum of different deposit (ids), in that case they are added here
    asset_type: string;
    create_block: BlockRef;
    controllers: Array<BalanceController>;
    contract_id?: string;
    controllers_hash: string;
  }

  
export interface BalanceController {
    type: 'HIVE' | 'DID' | 'CONTRACT',
    authority: string,
    conditions: Array<BalanceAccessCondition>
  }
  
  export interface BalanceAccessCondition {
    type: 'TIME' | 'HASH' | 'WITHDRAW',
    value: string
  }
  
  export interface TimeLock extends BalanceAccessCondition {
    type: 'TIME',
    lock_applied: BlockRef,
    expiration_block: number
  }
  
  export interface HashLock extends BalanceAccessCondition {
    type: 'HASH',
    hash: string,
  }
  
  export interface WithdrawLock extends BalanceAccessCondition {
    type: 'WITHDRAW',
    expiration_block: number
  }
  
  export interface DepositDrain {
    deposit_id: string,
    amount: number
  }