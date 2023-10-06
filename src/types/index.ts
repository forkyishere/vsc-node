// import { ContractOutputRaw } from './contracts'

export * from './contracts'

export enum NodeStorageType {
  //Stores complete state copies at every block rather than most recent state copy.
  verbose = "verbose",
  //Stores all state from all contracts and transactions. (historical transactions/outputs and current state only)
  //Useful for backup nodes or service providers wanting to keep copies of all contracts
  archive = "archive",
  //Stores state from only pinned smart contracts
  light = "light"
}

export interface LoggerConfig {
  prefix: string,
  level: string,
  printMetadata: boolean
}

enum authType {
  "posting" = 'posting',
  "active" = 'posting'
}

//Onchain link giving DID X authority
export interface DidAuth {
  [did: string]: {
    ats: authType[]
    memo?: string
  }
}

export interface DidAuthRecord {
  account: string
  did: string
  authority_type: authType[]
  valid_from: number
  valid_to: number | null
  tx_ref
}