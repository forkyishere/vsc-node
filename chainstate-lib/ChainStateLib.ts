

import { Collection, Db, WithId } from "mongodb";
import { ChainParserVSC } from "./chainParserVSC";
import { ChainParserHIVE } from "./chainParserHIVE";
import { IPFSHTTPClient } from "kubo-rpc-client/dist/src";
import { DID } from "dids";
import { TransactionDbRecord } from "./types/vscTransactions";
import { BlockHeader } from "./types/blockData";
import { Block } from "multiformats/dist/types/src/block";
import { Contract, ContractCommitment } from "./types/contracts";
import { DepositHelper } from "./depositHelper";
import { Deposit } from "./types/balanceData";
import EventEmitter from 'events';
import { networks } from 'bitcoinjs-lib';
import { Network } from "./types/network";

export interface IChainStateLib {
    chainParserVSC: ChainParserVSC;
    chainParserHIVE: ChainParserHIVE;
    stateHeaders: Collection;
    blockHeaders: Collection<BlockHeader>;
    witnessDb: Collection;
    balanceDb: Collection<Deposit>;
    transactionPool: Collection<WithId<TransactionDbRecord>>;
    contractCommitmentDb: Collection<ContractCommitment>
    didAuths: Collection;
    contractDb: Collection<Contract>;
    logger: ILogger;
    registerModules(registerMethod: (name: string, regClass: object) => void): Promise<void>;
    setConfig(config: IChainStateLibConfig): void;
    events: EventEmitter;
}

export interface IChainStateLibConfig {
    get(key: string): any;
}

export interface ILogger {
    warn(...args: any)
    error(...args: any)
    debug(...args: any)
    info(...args: any)
}

// various events can be acted on, e.g.:
// hive blocks
// vsc blocks
// stream check
// various hive core transactions of type CoreTransactionTypes

export enum ChainParserEvents {
    StreamCheck = 'hive_stream_check',
    StreamSynced = 'hive_stream_synced',
    StreamOutOfSync = 'hive_stream_out_of_sync',
    HiveBlock = 'hive_block',
    VscBlock = 'vsc_block',
    VerifiedWithdrawRequest = 'verified_withdraw_request',
}

export class ChainStateLib implements IChainStateLib {
    public chainParserVSC: ChainParserVSC;
    public chainParserHIVE: ChainParserHIVE;
    public stateHeaders: Collection;
    public blockHeaders: Collection<BlockHeader>;
    public witnessDb: Collection;
    public balanceDb: Collection<Deposit>;
    public transactionPool: Collection<WithId<TransactionDbRecord>>
    public contractCommitmentDb: Collection<ContractCommitment>
    public didAuths: Collection;
    public contractDb: Collection<Contract>
    public ipfs: IPFSHTTPClient;
    public identity: DID;
    public logger: ILogger
    public depositHelper: DepositHelper;
    public config: IChainStateLibConfig;
    public events: EventEmitter // pla: maybe switch out with something more efficient from rxjs     
    public networks: Record<string, Network>
    private db: Db;

    constructor(db: Db, ipfs: IPFSHTTPClient, identity: DID, logger: ILogger, networks: Record<string, Network>) {
        this.events = new EventEmitter()
        this.db = db;
        this.ipfs = ipfs;
        this.identity = identity;
        this.logger = logger;
        this.networks = networks;
        this.stateHeaders = this.db.collection('state_headers');
        this.blockHeaders = this.db.collection<BlockHeader>('block_headers');
        this.witnessDb = this.db.collection('witnesses');
        this.balanceDb = this.db.collection<Deposit>('balances');
        this.transactionPool = this.db.collection('transaction_pool')
        this.contractCommitmentDb = this.db.collection('contract_commitment')
        this.didAuths = this.db.collection('did_auths');
        this.contractDb = this.db.collection('contracts');        
        this.chainParserHIVE = new ChainParserHIVE(this);
        this.chainParserVSC = new ChainParserVSC(this);
        this.depositHelper = new DepositHelper(this.balanceDb);    
    }

    public setConfig(config: IChainStateLibConfig) {
        this.config = config;
    }

    public async registerModules(registerMethod: (name: string, regClass: object) => void) {
        registerMethod('ChainParserVSC', this.chainParserVSC);
        registerMethod('ChainParserHIVE', this.chainParserHIVE);
    }
}
