import { CID } from 'multiformats'
import NodeSchedule from 'node-schedule'
import dhive, { PrivateKey } from '@hiveio/dhive'
import { CoreService } from '.'
import { FastStream, HiveClient, unwrapDagJws } from '../utils'
import 'dotenv/config'
import { Collection } from 'mongodb'
import networks from './networks'
import { WitnessService } from './witness'
import type PQueue from 'p-queue'
import { VMScript } from 'vm2'
import * as vm from 'vm';
import Pushable from 'it-pushable'
import { CommitmentStatus, Contract, ContractCommitment } from '../../chainstate-lib/types/contracts'
import EventEmitter from 'events'
import { DagJWS, DagJWSResult, DID } from 'dids'
import { BalanceController, BlockHeader, BlockRecord, BlockRef, Deposit, DepositDrain, DidAuth, DidAuthRecord, TimeLock, TransactionConfirmed, TransactionDbStatus, TransactionDbType, WithdrawLock } from '../types'
import { VSCTransactionTypes, ContractInput, ContractOutput } from '../../lib/types/vscTransactions'
import { CoreTransactionTypes } from '../../lib/types/coreTransactions'
import moment from 'moment'
import { PayloadTooLargeException } from '@nestjs/common'
import { loggers } from 'winston'
import { YogaServer } from 'graphql-yoga'
import { WithdrawFinalization } from '../../lib/types/coreTransactions'
import { TransactionPoolService } from './transactionPool'

// pla: coordinates actions that require communication inbetween the 2 chains
// e.g.: sending a withdraw finalization hive transaction triggered via a vsc transaction 
export class ChainBridge {
  self: CoreService
  // blockHeaders: Collection<BlockHeader>
  // stateHeaders: Collection
  // contracts: Collection
  // witness: WitnessService
  // witnessDb: Collection
  // balanceDb: Collection<Deposit>
  // didAuths: Collection<DidAuthRecord>
  // events: EventEmitter
  // streamOut: Pushable.Pushable<any>
  // multiSigWithdrawBuffer: Array<Deposit>

  // blockQueue: PQueue
  // block_height: number
  // syncedAt: Date | null
  // ipfsQueue: PQueue
  // hiveStream: FastStream

  constructor(self: CoreService) {
    this.self = self

    // this.events = new EventEmitter()

    // this.syncedAt = null
  }

  // pla: the multisig consensus has been reached and a selected node now transfers the funds
  // move to transactionpoolservice?
  async finalizeBalanceUpdate(depositId: string) {
    const memo: WithdrawFinalization = {
      net_id: this.self.config.get('network.id'), 
      deposit_id: depositId,
      action: CoreTransactionTypes.withdraw_finalization
    } as WithdrawFinalization

    //TransactionPoolService.createCoreTransferTransaction... (amount = depositId.active_balance)
  }

  async processBalanceUpdate(block_height, block) {
    for (let i = this.multiSigWithdrawBuffer.length - 1; i >= 0; i--) {
      const withdraw = this.multiSigWithdrawBuffer[i];
      // ensure that there is a safe distance between the receival of the withdraw request and the current block
      const SAFE_BLOCK_DISTANCE = 5
      if (withdraw.create_block.included_block + SAFE_BLOCK_DISTANCE < block_height) {
        const multisigBalanceController = withdraw.controllers.find(c => c.authority === networks[this.self.config.get('network.id')].multisigAccount)

        if (multisigBalanceController) {
          const withdrawLock = <WithdrawLock>multisigBalanceController.conditions.find(c => c.type === 'WITHDRAW')
          
          if (withdrawLock && withdrawLock.expiration_block > block_height) {
            this.self.logger.info(`withdraw request for deposit ${withdraw.id} has been finalized`)
            // sign the balance update and publish via p2p multisig
            // maybe do some more checks/ verifications to ensure that everything is working as intended
          }
        }

        // when we get to this point, something has gone wrong OR we successfully signed and proposed the withdraw
        // in an error case either the request is expired, something is wrong with the data and so on
        // we remove the withdraw request from the buffer
        this.multiSigWithdrawBuffer.splice(i, 1);
      }
    }
  }

  async start() {
    this.chainParserHIVE.hiveBlockStream.on('block', (block_height, block) => {
      this.processBalanceUpdate(block_height, block);
  })



  //   this.stateHeaders = this.self.db.collection('state_headers')
  //   this.blockHeaders = this.self.db.collection<BlockHeader>('block_headers')
  //   this.witnessDb = this.self.db.collection('witnesses')
  //   this.balanceDb = this.self.db.collection('balances')
  //   this.didAuths = this.self.db.collection('did_auths')

    

  //   this.ipfsQueue = new (await import('p-queue')).default({ concurrency: 4 })
  //   this.multiSigWithdrawBuffer = [] 

  //   this.witness = new WitnessService(this.self)

  //   this.streamOut = Pushable()
    
    
  
  }
}
