

import { Collection, Db, WithId } from "mongodb";
import { ChainParserVSC } from "./chainParserVSC";
import { ChainParserHIVE } from "./chainParserHIVE";
import { IPFSHTTPClient } from "kubo-rpc-client/dist/src";
import { DID } from "dids";
import { TransactionDbRecord } from "./types/vscTransactions";
import { BlockHeader } from "./types/blockData";
import { Block } from "multiformats/dist/types/src/block";
import winston from "winston";
import { Contract, ContractCommitment } from "./types/contracts";
import { DepositHelper } from "./depositHelper";
import { Deposit } from "./types/balanceData";


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
    logger: winston.Logger;
    init(): Promise<void>;
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
    public logger: winston.Logger
    public depositHelper: DepositHelper;
    private db: Db;

    constructor(db: Db, ipfs: IPFSHTTPClient, identity: DID) {
        this.db = db;
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

    // pla: how to pass config? use same config as vsc nodes use!?

    public async init() {
        console.log('ChainStateLib init');
    }
}
