import { CID } from "kubo-rpc-client"
import { JsonPatchOp } from "./contracts"

export interface CoreVSCTransaction {
    action: string;
}

export interface ContractInput extends CoreVSCTransaction {
    contract_id: string,
    action: VSCTransactionTypes.call_contract,
    payload: any,
    salt?: string
}
  
export interface ContractUpdate extends CoreVSCTransaction {
    action: VSCTransactionTypes.update_contract,
    // TBD
}
  
export interface ContractOutput extends CoreVSCTransaction {
    action: VSCTransactionTypes.contract_output,
    contract_id: string,
    parent_tx_id?: string,
    inputs: Array<{
      id: string
    }>
    state_merkle: string
    //log: JsonPatchOp[]
    //Matrix of subdocuments --> individual logs
    log_matrix: Record<
      string,
      {
        log: JsonPatchOp[]
      }
    >
    chain_actions: any | null
}

export interface TransactionContractLogMatrix {
    log: JsonPatchOp[]
}

export enum VSCTransactionTypes {
    call_contract = "call_contract",
    contract_output = "contract_output",
    update_contract = "update_contract",
    transferFunds = "transfer_funds",
}

export interface TransactionContainer {
  id?: string //Created during signing
  __t: 'vsc-tx'
  __v: '0.1'
  lock_block: string
  included_in?: string | null
  accessible?: boolean
  tx: TransactionRaw
}

export interface TransactionDbRecord {
  id: string
  account_auth: string
  op: string
  lock_block: string | null
  status: TransactionDbStatus
  first_seen: Date
  type: TransactionDbType
  included_in: string | null
  executed_in: string | null
  output: string | null
  
  local: boolean
  accessible: boolean

  headers: Record<string, any>
  output_actions?: any
}

export enum TransactionDbStatus {
  unconfirmed = 'UNCONFIRMED',
  confirmed = 'CONFIRMED',
  failed = 'FAILED',
  included = 'INCLUDED',
  processed = 'PROCESSED' // pla: temporary state until official confirmation from block parsing
}

export enum TransactionDbType {
  null,
  input,
  output,
  virtual,
  core,
}

export interface TransactionConfirmed {
  op: string
  id: string // cid of transactionRaw
  type: TransactionDbType
}

export interface TransactionRaw {
  op: string
  payload: any // cid of ContractInput, ContractOutput or ContractUpdate and so on..
  type: TransactionDbType
}