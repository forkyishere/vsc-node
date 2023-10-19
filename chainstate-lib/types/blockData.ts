import { TransactionConfirmed } from "./vscTransactions"

//Engrained into the blockchain for reference
export interface BlockRecord {
  __t: 'vsc-block'
  __v: '0.1'
  state_updates: Record<string, string>
  //txs
  txs: Array<TransactionConfirmed>

  previous?: any
  timestamp: Date | string
}

export interface BlockRef {
  block_ref?: string,
  included_block: number 
}

export interface BlockHeader {
  hive_ref_block: number
  hive_ref_tx: string
  hive_ref_date: Date
  height: number
  id: string
}