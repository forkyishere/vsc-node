import { Collection } from "mongodb"
import { AllowWitness, CoreBaseTransaction, DissallowWitness, EnableWitness, TxMetadata, WithdrawFinalization } from "./types/coreTransactions"

export class ChainParser {
    witnessDb: Collection

    public ChainParser() {

    }

    async countHeight(id: string) {
      let block = (await this.self.ipfs.dag.get(CID.parse(id))).value
      let height = 0
  
      for (; ;) {
        if (block.previous) {
          block = (await this.self.ipfs.dag.get(block.previous)).value
          height = height + 1
        } else {
          break
        }
      }
  
      this.self.logger.debug('counted block height', height)
      return height
    }

    async enableWitness(account: string, enableWitnessTx: EnableWitness) {
        await this.witnessDb.findOneAndUpdate({
          name: txInfo.account
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

      async disableWitness(account: string) {
        await this.witnessDb.findOneAndUpdate({
          name: txInfo.account
        }, {
          $set: {
            active: false
          }
        }, {
          upsert: true
        })
      }

      async changeWitnessState(hiveTimestamp: Date, witnessChangeTx: AllowWitness | DissallowWitness, state: boolean) {
        const verifyData = await this.self.identity.verifyJWS(witnessChangeTx.proof)
        console.log('allow witness', verifyData)
        console.log(witnessChangeTx, verifyData.payload)
        const diff = hiveTimestamp.getTime() - new Date(verifyData.payload.ts).getTime()
        console.log('tx diff', diff)
        if (Math.abs(diff) < 30 * 1000) {
          try {
            await this.witnessDb.findOneAndUpdate({
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

      async dissallowWitness(hiveTimestamp: Date, dissallowWitnessTx: DissallowWitness) {
        const verifyData = await this.self.identity.verifyJWS(dissallowWitnessTx.proof)
        console.log('allow witness', verifyData)
        console.log(tx, verifyData.payload)
        const diff = txInfo.timestamp.getTime() - new Date(verifyData.payload.ts).getTime()
        console.log('tx diff', diff)
        if (Math.abs(diff) < 30 * 1000) {
          try {
            await this.witnessDb.findOneAndUpdate({
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

      async retrieveVSCBlock(txInfo: TxMetadata, announceBlockTx: AnnounceBlock) {
         /**
           * TODO: Calculate expected witness account
           */
         const expectedAccount = ""
         if (txInfo.account === expectedAccount) {
   
         }
   
         const data = await this.self.ipfs.dag.get(CID.parse(announceBlockTx.block_hash))
   
         // console.log(JSON.stringify(data.value, null, 2))
         for (let tx of data.value.txs) {
           await this.self.transactionPool.transactionPool.findOneAndUpdate({
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

      async createContract(tx: any, createContractTx: CreateContract) {
        try {
          await this.self.contractEngine.contractDb.insertOne({
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

      async joinContract(tx: any, joinContractTx: JoinContract) {
        const commitment = await this.self.contractEngine.contractCommitmentDb.findOne({
          contract_id: joinContractTx.contract_id,
          node_identity: joinContractTx.node_identity
        })
  
        if (commitment === null) {
          try {
            await this.self.contractEngine.contractCommitmentDb.insertOne({
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
          await this.self.contractEngine.contractCommitmentDb.findOneAndUpdate(commitment, {
            $set: {
              status: CommitmentStatus.active
            }
          })
        }
      }

      async leaveContract(leaveContractTx: LeaveContract) {
        const commitment = await this.self.contractEngine.contractCommitmentDb.findOne({
          contract_id: leaveContractTx.contract_id,
          node_identity: leaveContractTx.node_identity
        })
  
        if (commitment !== null) {
          await this.self.contractEngine.contractCommitmentDb.findOneAndUpdate(commitment, {
            $set: {
              status: CommitmentStatus.inactive
            }
          })
        } else {
          this.self.logger.warn('not able to leave contract commitment', tx.transaction_id)
        }
      }

      async deposit(tx: any, depositTx: Deposit, txInfo: TxMetadata) {
        if (txInfo.to === networks[this.self.config.get('network.id')].multisigAccount) {   
          const balanceController = { type: 'HIVE', authority: depositTx.to ?? txInfo.account, conditions: []} as BalanceController
  
          const transferedCurrency = TransactionPoolService.parseFormattedAmount(txInfo.amount);
  
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
  
          await this.balanceDb.insertOne(deposit);        
        }
        else {
          this.self.logger.warn(`received deposit (${depositTx.action}), but the target account is not the multisig acc`, tx.transaction_id)
        }
      }

      async withdrawRequest(tx: any, withdrawRequestTx: WithdrawRequest, txInfo: TxMetadata) {
        let deposits = await this.getUserControlledBalances(txInfo.account);
    
          const currentBlock = {
            block_ref: '', // txInfo.block_ref TODO, block ref still needs to be passed down to processCoreTransaction -> txInfo 
            included_block: +txInfo.block_height
          } as BlockRef
    
          deposits = this.getDepositsWithMetConditions(deposits, currentBlock);
    
          const determinedDepositDrains = this.determineDepositDrains(deposits, withdrawRequestTx.amount);
    
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
    
            await this.balanceDb.insertOne(deposit); 
            
            await this.updateSourceDeposits(determinedDepositDrains.deposits, tx.transaction_id);
    
            // pla: TODO STORE in a database so the tasks for the multisig allowed nodes are not lost on restart
            this.multiSigWithdrawBuffer.push(deposit);
          }
       }

      async withdrawFinalization(tx: any, withdrawFinalizationTx: WithdrawFinalization, txInfo: TxMetadata) {
        if (tx.from === networks[this.self.config.get('network.id')].multisigAccount) {
            const transferedCurrency = TransactionPoolService.parseFormattedAmount(txInfo.amount);
    
            const deposit = await this.balanceDb.findOne({ id: withdrawFinalizationTx.deposit_id })
    
            if (deposit.active_balance === transferedCurrency.amount) {
              await this.balanceDb.updateOne({ id: withdrawFinalizationTx.deposit_id }, 
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

      async processCoreTransaction(tx: any, json: CoreBaseTransaction, txInfo: TxMetadata) {
        if (json.net_id !== this.self.config.get('network.id')) {
          this.self.logger.warn('received transaction from a different network id! - will not process')
          return;
        }
        console.log(json)

        switch (json.action) {
          case CoreTransactionTypes.enable_witness:
            this.allowWitness(txInfo.account, json);
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
            this.retrieveVSCBlock(txInfo, json)
            break;
          case CoreTransactionTypes.create_contract:
            this.createContract(tx, json)
            break;
          case CoreTransactionTypes.join_contract:
            this.joinContract(tx, json)
            break;
          case CoreTransactionTypes.leave_contract:
            this.leaveContract(json)
            break;
          case CoreTransactionTypes.deposit:
            this.deposit(tx, json, txInfo)
            break;
          case CoreTransactionTypes.withdraw_finalization:
            this.withdrawFinalization(tx, json, txInfo)
            break;
          case CoreTransactionTypes.withdraw_finalization:
            this.withdrawFinalization(tx, json, txInfo)
            break;
          default: 
            this.self.logger.warn('not recognized tx type', withdrawFinalizationTx.action)
            break;
        }

        if (json.action === CoreTransactionTypes.enable_witness) {
        } else if (json.action === CoreTransactionTypes.disable_witness) {
        } else if (json.action === CoreTransactionTypes.allow_witness) {
        } else if (json.action === CoreTransactionTypes.dissallow_witness) {
        } else if (json.action === CoreTransactionTypes.announce_block) {
        } else if (json.action === CoreTransactionTypes.create_contract) {
        } else if (json.action === CoreTransactionTypes.join_contract) {
        } else if (json.action === CoreTransactionTypes.leave_contract) {
        } else if (json.action === CoreTransactionTypes.deposit) {
        } else if (json.action === CoreTransactionTypes.withdraw_request) {
        } else if (json.action === CoreTransactionTypes.withdraw_finalization) {
      }
    
}