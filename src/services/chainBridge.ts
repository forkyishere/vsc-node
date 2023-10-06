import { CID } from 'multiformats'
import NodeSchedule from 'node-schedule'
import dhive, { PrivateKey } from '@hiveio/dhive'
import { CoreService } from '.'
import { fastStream, HiveClient, unwrapDagJws } from '../utils'
import 'dotenv/config'
import { Collection } from 'mongodb'
import networks from './networks'
import { WitnessService } from './witness'
import type PQueue from 'p-queue'
import { VMScript } from 'vm2'
import * as vm from 'vm';
import Pushable from 'it-pushable'
import { CommitmentStatus, Contract, ContractCommitment } from '../types/contracts'
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
  hiveKey: dhive.PrivateKey
  blockHeaders: Collection<BlockHeader>
  stateHeaders: Collection
  contracts: Collection
  witness: WitnessService
  witnessDb: Collection
  balanceDb: Collection<Deposit>
  didAuths: Collection<DidAuthRecord>
  events: EventEmitter
  streamOut: Pushable.Pushable<any>
  multiSigWithdrawBuffer: Array<Deposit>

  blockQueue: PQueue
  block_height: number
  syncedAt: Date | null
  ipfsQueue: PQueue
  hiveStream: fastStream

  constructor(self: CoreService) {
    this.self = self

    this.events = new EventEmitter()

    this.syncedAt = null
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

  async streamStart() {

    const network_id = this.self.config.get('network.id')

    this.self.logger.debug('current network_id', network_id)

    let startBlock =
      (
        (await this.stateHeaders.findOne({
          id: 'hive_head',
        })) || ({} as any)
      ).block_num || networks[network_id].genesisDay

    if (this.self.config.get('debug.startBlock') !== undefined && this.self.config.get('debug.startBlock') !== null) {
      startBlock = +this.self.config.get('debug.startBlock');
    }

    if (this.self.config.get('debug.startAtCurrentBlock')) {
      const currentBlock = await HiveClient.blockchain.getCurrentBlock();
      const block_height = parseInt(currentBlock.block_id.slice(0, 8), 16);
      startBlock = block_height;
    }

    this.self.logger.debug('starting block stream at height', startBlock)
    this.hiveStream = await fastStream.create({
      //startBlock: networks[network_id].genesisDay,
      startBlock: startBlock,
      trackHead: true
    })
    void (async () => {
      try {

        for await (let [block_height, block] of this.hiveStream.streamOut) {
          this.block_height = block_height;
          for(let tx of block.transactions) {
            try {
              const headerOp = tx.operations[tx.operations.length - 1]
              if(headerOp[0] === "custom_json") {
                if (headerOp[1].required_posting_auths.includes(networks[this.self.config.get('network.id')].multisigAccount)) {
                  try {
                    const json = JSON.parse(headerOp[1].json)
                    
                    await this.self.transactionPool.transactionPool.findOneAndUpdate({
                      id: json.ref_id
                    }, {
                      $set: {
                        'output_actions.$.ref_id': tx.id
                      }
                    })
                  } catch {
    
                  }
                }
              }
              for(let [op_id, payload] of tx.operations) {
                // if(payload.json_metadata && payload.memo_key) {
                //   console.log(op_id, payload)
                // }
                
                if(op_id === "account_update") {
                  try {
                    const json_metadata = JSON.parse(payload.json_metadata)
                    if (json_metadata.vsc_node) {
                      const { payload: proof, kid } = await this.self.identity.verifyJWS(json_metadata.vsc_node.signed_proof)
                      const [did] = kid.split('#')
                      console.log(proof)
    
    
                      const witnessRecord = await this.witnessDb.findOne({
                        account: payload.account
                      }) || {} as any
    
                      const opts = {}
                      if((witnessRecord.enabled === true && proof.witness.enabled === false) || typeof witnessRecord.disabled_at === 'undefined') {
                        opts['disabled_at'] = block_height
                        opts["disabled_reason"] = proof.witness.disabled_reason
                      } else if((proof.witness.enabled === true && typeof witnessRecord.disabled_at === 'number') || typeof witnessRecord.enabled_at === 'undefined' ) {
                        opts['enabled_at'] = block_height
                        opts['disabled_at'] = null
                        opts['disabled_reason'] = null
                      }
    
                      if(json_metadata.did_auths) {
                        const did_auths = json_metadata.did_auths as DidAuth
    
                        const currentDidAuths = (await this.didAuths.find({
                          account: payload.account,
                          did: {$in: Object.keys(did_auths)}
                        }).toArray())
    
                        await this.didAuths.updateMany({
                          _id: {
                            $nin: currentDidAuths.map(e => e._id)
                          }
                        }, {
                          $set: {
                            valid_to: payload.account
                          }
                        })
    
                        const unindexdDids = did_auths
                        for(let cta of currentDidAuths) {
                          if(unindexdDids[cta.did] && unindexdDids[cta.did].ats === cta.authority_type) {
                            delete unindexdDids[cta.did];
                          }
                        }
    
                        for(let [did, val] of Object.entries(unindexdDids)) {
                          await this.didAuths.findOneAndUpdate({
                            did: did,
                            account: payload.account,
                            // valid_to: {
                            //   $ne: null
                            // }
                          }, {
                            $set: {
                              authority_type: val.ats,
                              valid_from: block_height,
                              valid_to: null
                            }
                          }, {
                            upsert: true
                          })
                        }
                      }
    
                      await this.witnessDb.findOneAndUpdate({
                        account: payload.account,
                      }, {
                        $set: {
                          did,
                          peer_id: proof.ipfs_peer_id,
                          signing_keys: proof.witness.signing_keys,
                          enabled: proof.witness.enabled,
                          last_signed: new Date(proof.ts),
                          net_id: proof.net_id,
                          git_commit: proof.git_commit,
                          plugins: proof.witness.plugins || [],
                          last_tx: tx.transaction_id,
                          ...opts
                        }
                      }, {
                        upsert: true
                      })
                    }
                  } catch(ex) {
                    console.log(ex)
                  }
                }
                if (op_id === "custom_json") {
                  if (payload.id === 'vsc-testnet-hive' || payload.id.startsWith('vsc.')) {
                    const json = JSON.parse(payload.json)
                    await this.processCoreTransaction(tx, json, {
                      account: payload.required_posting_auths[0],
                      block_height,
                      timestamp: new Date(block.timestamp + "Z")
                    })   
                  }
                } else if (op_id === "transfer") {
                  // console.log(payload)
                  // checking for to and from tx to be the multisig account, because all other transfers are not related to vsc
                  if ([payload.to, payload.from].includes(networks[this.self.config.get('network.id')].multisigAccount)) {
                    if (payload.memo) {
                      const json = JSON.parse(payload.memo)
                        await this.processCoreTransaction(tx, json, {
                          account: payload.from, // from or payload.required_posting_auths[0]?
                          block_height,
                          timestamp: new Date(block.timestamp + "Z"),
                          amount : payload.amount,
                          to: payload.to,
                          memo: payload.memo
                        })
                    } else {
                      this.self.logger.warn('received transfer without memo, considering this a donation as we cant assign it to a specific network', payload)
                    }     
                  }         
                }  
              }           
            } catch(ex) {
              console.log(ex)
            }
          }
  
          if (this.self.config.get('debug.debugNodeAddresses')?.includes(this.self.config.get('identity.nodePublic'))) {
            this.self.logger.debug(`current block_head height ${block_height}`)
          }
          await this.stateHeaders.findOneAndUpdate(
            {
              id: 'hive_head',
            },
            {
              $set: {
                block_num: block_height,
              },
            },
            {
              upsert: true,
            },
          )
  
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
      } catch (ex) {
        console.log(ex)
      }
    })()
    this.hiveStream.startStream()
  }

  async streamStop() {

  }

  /**
   * Verifies streaming is working correctly
   */
  async streamCheck() {
    if (this.hiveStream.blockLag > 300 && typeof this.hiveStream.blockLag === 'number') {
      // await this.self.nodeInfo.announceNode({
      //   action: "disable_witness",
      //   disable_reason: "sync_fail"
      // })

      await this.self.nodeInfo.setStatus({
        id: "out_of_sync",
        action: "disable_witness",
        expires: moment().add('1', 'day').toDate()
      })
    }

    if (this.syncedAt !== null) {
      if (this.hiveStream.blockLag > 300) {
        // await this.self.nodeInfo.announceNode({
        //   action: "disable_witness",
        //   disable_reason: "sync_fail"
        // })

        await this.self.nodeInfo.setStatus({
          id: "out_of_sync",
          action: "disable_witness",
          expires: moment().add('1', 'day').toDate()
        })


        this.hiveStream.killStream()
        this.streamStart()
        this.syncedAt = null


        return;
      }
      if (moment.isDate(this.hiveStream.lastBlockTs) && moment().subtract('1', 'minute').toDate().getTime() > this.hiveStream.lastBlockTs.getTime()) {
        console.log('KILLING STREAM', this.hiveStream.blockLag)

        this.hiveStream.killStream()
        this.streamStart()

        this.syncedAt = null

        return
      }
    }
    if (this.syncedAt === null && typeof this.hiveStream.blockLag === 'number' && this.hiveStream.blockLag < 5) {
      console.log('[streamCheck] System synced!')
      this.syncedAt = new Date();
      await this.self.nodeInfo.nodeStatus.deleteMany({
        id: "out_of_sync",
      })
    }
  }

  async start() {
    this.stateHeaders = this.self.db.collection('state_headers')
    this.blockHeaders = this.self.db.collection<BlockHeader>('block_headers')
    this.witnessDb = this.self.db.collection('witnesses')
    this.balanceDb = this.self.db.collection('balances')
    this.didAuths = this.self.db.collection('did_auths')

    if(process.env.HIVE_ACCOUNT_POSTING) {
      this.hiveKey = PrivateKey.fromString(process.env.HIVE_ACCOUNT_POSTING)
    }

    this.ipfsQueue = new (await import('p-queue')).default({ concurrency: 4 })
    this.multiSigWithdrawBuffer = [] 

    this.witness = new WitnessService(this.self)

    this.streamOut = Pushable()
    
    
    
    if(this.self.mode !== 'lite') {
      
      this.events.on('vsc_block', (block) => {
        this.streamOut.push(block)
      })
      
      NodeSchedule.scheduleJob('* * * * *', async () => {
        await this.verifyMempool()
      })
          
      // console.log(new Date().getTime() - date.getTime(), blist.length)
      setInterval(() => {
        this.streamCheck()
      }, 5000)
      const network_id = this.self.config.get('network.id')
      await this.streamStart()

      void (async () => {
        for await (let block of this.streamOut) {
          console.log('vsc block', block)
  
          const blockContent = (await this.self.ipfs.dag.get(CID.parse(block.block_hash))).value
          console.log(blockContent)
          await this.blockHeaders.insertOne({
            height: await this.countHeight(block.block_hash),
            id: block.block_hash,
            hive_ref_block: block.tx.block_num,
            hive_ref_tx: block.tx.transaction_id,
            hive_ref_date: block.timestamp
            // witnessed_by: {
            //   hive_account: block.tx.posting
            // }
          })
  
          for (let tx of blockContent.txs) {
            this.processVSCBlockTransaction(tx, block.block_hash);
          }
        }
      })()
  
      let blkNum;
      setInterval(async() => {
        const diff = (blkNum - this.hiveStream.blockLag) || 0
        blkNum = this.hiveStream.blockLag
        
        this.self.logger.info(`current block lag ${this.hiveStream.blockLag} ${Math.round(diff / 15)}`)
        const stateHeader = await this.stateHeaders.findOne({
          id: 'hive_head'
        })
        if(stateHeader) {
          this.self.logger.info(`current parse lag ${this.hiveStream.calcHeight - stateHeader.block_num}`, stateHeader)
        }
      }, 15 * 1000)
  
      let producingBlock = false;
      setInterval(async () => {
        if (this.hiveStream.blockLag < 5) {
          //Can produce a block
          const offsetBlock = this.hiveStream.lastBlock //- networks[network_id].genesisDay
          if ((offsetBlock % networks[network_id].roundLength) === 0) {
            if (!producingBlock) {
              const nodeInfo = await this.witnessDb.findOne({
                did: this.self.identity.id
              })
              if (nodeInfo) {
                const scheduleSlot = this.self.witness.witnessSchedule?.find((e => {
                  return e.bn === offsetBlock
                }))
                //console.log('scheduleSlot', scheduleSlot, offsetBlock)
                if (nodeInfo.enabled) {
  
  
                  if (scheduleSlot?.did === this.self.identity.id) {
                    this.self.logger.info('Can produce block!! at', this.hiveStream.lastBlock)
                    producingBlock = true;
                    await this.createBlock()
                  }
                }
              }
            }
          } else {
            producingBlock = false;
          }
        }
      }, 300)
    }
  }
}
