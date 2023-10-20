import { Collection, Join } from "mongodb"
import { AllowWitness, AnnounceBlock, CoreBaseTransaction, CoreTransactionTypes, CreateContract, DepositAction, DissallowWitness, EnableWitness, JoinContract, LeaveContract, TxMetadata, WithdrawFinalization, WithdrawRequest } from "./types/coreTransactions"
import { ChainStateLib } from "./ChainStateLib"
import { CID } from "kubo-rpc-client/dist/src"
// import { TransactionPoolService } from "@/services/transactionPool"
import { networks } from "bitcoinjs-lib"
import { BalanceController, Deposit, TimeLock, WithdrawLock } from "./types/balanceData"
import { BlockRef } from "./types/blockData"
import { Contract, CommitmentStatus, ContractCommitment } from "./types/contracts"
import { TransactionDbStatus } from "./types/vscTransactions"
import { DepositHelper } from "./depositHelper"
import Pushable from 'it-pushable'
import pushable from "it-pushable"
import EventEmitter from 'events'
import { FastStream, HiveClient, unwrapDagJws } from '../utils'
import { DidAuth } from "@/types"


export class ChainParserHIVE {
  private self: ChainStateLib
  // pla: for each of the received transactions emit an event, so that other parts of the application can react to it
  // e.g.: 
  // withdrawRequestEmitted: EventEmitter<WithdrawRequest> = new EventEmitter();

  constructor(self: ChainStateLib) {
    this.self = self
  }

  private async enableWitness(account: string, enableWitnessTx: EnableWitness) {
    await this.self.witnessDb.findOneAndUpdate({
      name: account
    }, {
      $set: {
        did: enableWitnessTx.did,
        node_id: enableWitnessTx.node_id,
        active: true
      }
    }, {
      upsert: true
    })
  }

  private async disableWitness(account: string) {
    await this.self.witnessDb.findOneAndUpdate({
      name: account
    }, {
      $set: {
        active: false
      }
    }, {
      upsert: true
    })
  }

  private async changeWitnessState(hiveTimestamp: Date, witnessChangeTx: AllowWitness | DissallowWitness, state: boolean) {
    const verifyData = await this.self.identity.verifyJWS(witnessChangeTx.proof)
    console.log('allow witness', verifyData)
    console.log(witnessChangeTx, verifyData.payload)
    const diff = hiveTimestamp.getTime() - new Date(verifyData.payload.ts).getTime()
    console.log('tx diff', diff)
    if (Math.abs(diff) < 30 * 1000) {
      try {
        await this.self.witnessDb.findOneAndUpdate({
          did: verifyData.payload.node_id
        }, {
          $set: {
            trusted: state
          }
        })
      } catch {

      }
    } else {
      this.self.logger.warn(`received transaction with high lag. Possible replay attack - ${tx.transaction_id}`)
    }
  }

  private async dissallowWitness(hiveTimestamp: number, dissallowWitnessTx: DissallowWitness) {
    const verifyData = await this.self.identity.verifyJWS(dissallowWitnessTx.proof)
    console.log('allow witness', verifyData)
    // console.log(tx, verifyData.payload)
    const diff = hiveTimestamp - new Date(verifyData.payload.ts).getTime()
    console.log('tx diff', diff)
    if (Math.abs(diff) < 30 * 1000) {
      try {
        await this.self.witnessDb.findOneAndUpdate({
          did: verifyData.payload.node_id
        }, {
          $set: {
            trusted: false
          }
        })
      } catch {

      }
    } else {
      this.self.logger.warn(`received transaction with high lag. Possible replay attack - ${tx.transaction_id}`)
    }
  }

  private async retrieveVSCBlock(txInfo: TxMetadata, announceBlockTx: AnnounceBlock) {
    /**
      * TODO: Calculate expected witness account
      */
    const expectedAccount = ""
    if (txInfo.account === expectedAccount) {

    }

    const data = await this.self.ipfs.dag.get(CID.parse(announceBlockTx.block_hash))

    // console.log(JSON.stringify(data.value, null, 2))
    for (let tx of data.value.txs) {
      await this.self.transactionPool.findOneAndUpdate({
        id: tx.id.toString()
      }, {
        $set: {
          status: TransactionDbStatus.included
        }
      })
      console.log(tx)
      const txData = (await this.self.ipfs.dag.get(tx.id)).value
      const txData2 = (await this.self.ipfs.dag.get(tx.id, {
        path: 'link'
      })).value
      const verifyData = await this.self.identity.verifyJWS(txData)
      console.log(verifyData, txData, txData2)
    }

    // TODO, determine if the received block was proposed by the correct witness
    this.events.emit('vsc_block', {
      ...announceBlockTx,
      ...txInfo,
      tx // TODONEW check if tx can be removed, think so, not used in processvsctx
    })
  }

  private async createContract(tx: any, createContractTx: CreateContract) {
    try {
      await this.self.contractDb.insertOne({
        id: tx.transaction_id,
        manifest_id: createContractTx.manifest_id,
        name: createContractTx.name,
        code: createContractTx.code,
        state_merkle: (await this.self.ipfs.object.new({ template: 'unixfs-dir' })).toString(),
        creation_tx: tx.transaction_id,
        created_at: tx.expiration
      } as Contract)
    } catch (err) {
      this.self.logger.error('not able to inject contract into the local database', tx.transaction_id)
    }
  }

  private async joinContract(tx: any, joinContractTx: JoinContract) {
    const commitment = await this.self.contractCommitmentDb.findOne({
      contract_id: joinContractTx.contract_id,
      node_identity: joinContractTx.node_identity
    })

    if (commitment === null) {
      try {
        await this.self.contractCommitmentDb.insertOne({
          id: tx.transaction_id,
          node_id: joinContractTx.node_id,
          node_identity: joinContractTx.node_identity,
          contract_id: joinContractTx.contract_id,
          creation_tx: tx.transaction_id,
          created_at: tx.expiration,
          status: CommitmentStatus.active,
          latest_state_merkle: null,
          latest_update_date: null,
          last_pinged: null,
          pinged_state_merkle: null
        } as ContractCommitment)
      } catch (err) {
        this.self.logger.error('not able to inject contract commitment into the local database', tx.transaction_id)
      }
    } else {
      await this.self.contractCommitmentDb.findOneAndUpdate(commitment, {
        $set: {
          status: CommitmentStatus.active
        }
      })
    }
  }

  private async leaveContract(leaveContractTx: LeaveContract) {
    const commitment = await this.self.contractCommitmentDb.findOne({
      contract_id: leaveContractTx.contract_id,
      node_identity: leaveContractTx.node_identity
    })

    if (commitment !== null) {
      await this.self.contractCommitmentDb.findOneAndUpdate(commitment, {
        $set: {
          status: CommitmentStatus.inactive
        }
      })
    } else {
      this.self.logger.warn('not able to leave contract commitment', tx.transaction_id)
    }
  }

  private async deposit(tx: any, depositTx: DepositAction, txInfo: TxMetadata) {
    if (txInfo.to === networks[this.self.config.get('network.id')].multisigAccount) {
      const balanceController = { type: 'HIVE', authority: depositTx.to ?? txInfo.account, conditions: [] } as BalanceController

      const transferedCurrency = DepositHelper.parseFormattedAmount(txInfo.amount);

      const deposit = {
        from: txInfo.account,
        id: tx.transaction_id,
        orig_balance: transferedCurrency.amount,
        active_balance: transferedCurrency.amount,
        created_at: tx.expiration,
        last_interacted_at: tx.expiration,
        outputs: [],
        inputs: [],
        asset_type: transferedCurrency.assetSymbol,
        create_block: {
          block_ref: '', // txInfo.block_ref TODO, block ref still needs to be passed down to processCoreTransaction -> txInfo 
          included_block: +txInfo.block_height
        } as BlockRef,
        controllers: [balanceController],
      } as Deposit

      if (depositTx.contract_id) {
        deposit.contract_id = depositTx.contract_id ?? null // limits the deposit on a specific contract
      }

      await this.self.balanceDb.insertOne(deposit);
    }
    else {
      this.self.logger.warn(`received deposit (${depositTx.action}), but the target account is not the multisig acc`, tx.transaction_id)
    }
  }

  private async withdrawRequest(tx: any, withdrawRequestTx: WithdrawRequest, txInfo: TxMetadata) {
    let deposits = await this.self.depositHelper.getUserControlledBalances(txInfo.account);

    const currentBlock = {
      block_ref: '', // txInfo.block_ref TODO, block ref still needs to be passed down to processCoreTransaction -> txInfo 
      included_block: +txInfo.block_height
    } as BlockRef

    deposits = this.self.depositHelper.getDepositsWithMetConditions(deposits, currentBlock);

    const determinedDepositDrains = this.self.depositHelper.determineDepositDrains(deposits, withdrawRequestTx.amount);

    if (!determinedDepositDrains.isEnoughBalance) {
      this.self.logger.warn('withdraw request failed, not sufficient funds available, will not add to database', withdrawRequestTx)
    } else {
      const WITHDRAW_FAILED_BLOCK_DISTANCE = 200; // pla: this setting determines within how many blocks the withdraw should be executed by the multisig allowed nodes, if they fail to do so the withdraw is unlocked again and the balance will be treated like a deposit again
      const userBalanceController = {
        type: 'HIVE',
        authority: withdrawRequestTx.to ?? txInfo.account,
        conditions: [
          {
            type: 'TIME',
            lock_applied: currentBlock,
            expiration_block: currentBlock.included_block + WITHDRAW_FAILED_BLOCK_DISTANCE
          } as TimeLock
        ]
      } as BalanceController

      const multisigBalanceController = {
        type: 'HIVE',
        authority: networks[this.self.config.get('network.id')].multisigAccount,
        conditions: [
          {
            type: 'WITHDRAW',
            expiration_block: currentBlock.included_block + WITHDRAW_FAILED_BLOCK_DISTANCE // here the failed block distance is the other way around, the multisig only has the time window from the withdraw request until the WITHDRAW_FAILED_BLOCK_DISTANCE to execute the withdraw
          } as WithdrawLock
        ]
      } as BalanceController

      const deposit = {
        from: txInfo.account,
        id: tx.transaction_id,
        orig_balance: withdrawRequestTx.amount,
        active_balance: withdrawRequestTx.amount,
        created_at: tx.expiration,
        last_interacted_at: tx.expiration,
        outputs: [],
        inputs: [...determinedDepositDrains.deposits],
        asset_type: 'HIVE', // TODO, update so its recognized what type of asset has requested for withdraw
        create_block: currentBlock,
        controllers: [userBalanceController, multisigBalanceController],
      } as Deposit

      await this.self.balanceDb.insertOne(deposit);

      await this.self.depositHelper.updateSourceDeposits(determinedDepositDrains.deposits, tx.transaction_id);

      // TODONEW: DONT DO HERE, DO ON EVENT EMIT?
      // pla: TODO STORE in a database so the tasks for the multisig allowed nodes are not lost on restart
      // this.multiSigWithdrawBuffer.push(deposit);
    }
  }

  private async withdrawFinalization(tx: any, withdrawFinalizationTx: WithdrawFinalization, txInfo: TxMetadata) {
    if (tx.from === networks[this.self.config.get('network.id')].multisigAccount) {
      const transferedCurrency = DepositHelper.parseFormattedAmount(txInfo.amount);

      const deposit = await this.self.balanceDb.findOne({ id: withdrawFinalizationTx.deposit_id })

      if (deposit.active_balance === transferedCurrency.amount) {
        await this.self.balanceDb.updateOne({ id: withdrawFinalizationTx.deposit_id },
          {
            $set: {
              active_balance: 0
            }
          }
        )
      } else {
        // pla: something went really wrong here, if this is the case, def. investigate
        this.self.logger.warn(`received withdraw finalization, but the balance is not the same as the withdraw request, will not update the balance`, tx.transaction_id)
      }
    } else {
      this.self.logger.warn(`received withdraw finalization from non multisig account, disregarding`, tx.transaction_id)
    }
  }

  private async processCoreTransaction(tx: any, json: CoreBaseTransaction, txInfo: TxMetadata) {
    if (json.net_id !== this.self.config.get('network.id')) {
      this.self.logger.warn('received transaction from a different network id! - will not process')
      return;
    }
    console.log(json)

    switch (json.action) {
      case CoreTransactionTypes.enable_witness:
        this.enableWitness(txInfo.account, <EnableWitness>json);
        break;
      case CoreTransactionTypes.disable_witness:
        this.disableWitness(txInfo.account);
        break;
      case CoreTransactionTypes.allow_witness:
        this.changeWitnessState(txInfo.timestamp, <AllowWitness>json, true)
        break;
      case CoreTransactionTypes.dissallow_witness:
        this.changeWitnessState(txInfo.timestamp, <DissallowWitness>json, false)
        break;
      case CoreTransactionTypes.announce_block:
        this.retrieveVSCBlock(txInfo, <AnnounceBlock>json)
        break;
      case CoreTransactionTypes.create_contract:
        this.createContract(tx, <CreateContract>json)
        break;
      case CoreTransactionTypes.join_contract:
        this.joinContract(tx, <JoinContract>json)
        break;
      case CoreTransactionTypes.leave_contract:
        this.leaveContract(<LeaveContract>json)
        break;
      case CoreTransactionTypes.deposit:
        this.deposit(tx, <DepositAction>json, txInfo)
        break;
      case CoreTransactionTypes.withdraw_finalization:
        this.withdrawFinalization(tx, <WithdrawFinalization>json, txInfo)
        break;
      default:
        this.self.logger.warn('not recognized tx type', json.action)
        break;
    }
  }

  // TODONEW, pla: still a lot of room for future refactors
  async streamStart() {

    const network_id = this.self.config.get('network.id')

    this.self.logger.debug('current network_id', network_id)

    let startBlock =
      (
        (await this.self.stateHeaders.findOne({
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
    this.hiveStream = await FastStream.create({
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
                    
                    await this.self.transactionPool.findOneAndUpdate({
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
    
    
                      const witnessRecord = await this.self.witnessDb.findOne({
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
    
                        const currentDidAuths = (await this.self.didAuths.find({
                          account: payload.account,
                          did: {$in: Object.keys(did_auths)}
                        }).toArray())
    
                        await this.self.didAuths.updateMany({
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
                          await this.self.didAuths.findOneAndUpdate({
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
    
                      await this.self.witnessDb.findOneAndUpdate({
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
          await this.self.stateHeaders.findOneAndUpdate(
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
  
          // TODONEW, think about if this is the right way of doing it
          this.hiveBlockStream.emit('block', block_height, block)
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

  public vscBlockStream: Pushable.Pushable<any>;
  // exposes the blockstream of hiveblocks after main processing of core transactions
  public hiveBlockStream: EventEmitter = new EventEmitter()
  private hiveStream: FastStream
  private block_height: number

  async streamStateNotifier() {
    let blkNum;
    setInterval(async() => {
      const diff = (blkNum - this.hiveStream.blockLag) || 0
      blkNum = this.hiveStream.blockLag
      
      this.self.logger.info(`current block lag ${this.hiveStream.blockLag} ${Math.round(diff / 15)}`)
      const stateHeader = await this.self.stateHeaders.findOne({
        id: 'hive_head'
      })
      if(stateHeader) {
        this.self.logger.info(`current parse lag ${this.hiveStream.calcHeight - stateHeader.block_num}`, stateHeader)
      }
    }, 15 * 1000)
  }
  
  async start() {
    this.vscBlockStream = Pushable()

    if(this.self.mode !== 'lite') {

      setInterval(() => {
        this.streamCheck()
      }, 5000)
      const network_id = this.self.config.get('network.id')

      // TODONEW, maybe figure out what can still be structured otherwise in terms of laying off logic to FastStreamHIVE, specifically mean code from streamstart/ streamStateNotifier
      await this.streamStart()

      await this.streamStateNotifier()
    }
  }
}