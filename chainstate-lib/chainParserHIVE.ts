import { Collection } from "mongodb"

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

      async processCoreTransaction(tx: any, json: any, txInfo: {
        account: string,
        block_height: string,
        timestamp: Date,
        amount?: string,
        to?: string
        memo?: string
      }) {
        if (json.net_id !== this.self.config.get('network.id')) {
          this.self.logger.warn('received transaction from a different network id! - will not process')
          return;
        }
        console.log(json)
        if (json.action === CoreTransactionTypes.enable_witness) {
          await this.witnessDb.findOneAndUpdate({
            name: txInfo.account
          }, {
            $set: {
              did: json.did,
              node_id: json.node_id,
              active: true
            }
          }, {
            upsert: true
          })
        } else if (json.action === CoreTransactionTypes.disable_witness) {
          await this.witnessDb.findOneAndUpdate({
            name: txInfo.account
          }, {
            $set: {
              active: false
            }
          }, {
            upsert: true
          })
        } else if (json.action === CoreTransactionTypes.allow_witness) {
          const verifyData = await this.self.identity.verifyJWS(json.proof)
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
                  trusted: true
                }
              })
            } catch {
    
            }
          } else {
            this.self.logger.warn(`received transaction with high lag. Possible replay attack - ${tx.transaction_id}`)
          }
        } else if (json.action === CoreTransactionTypes.dissallow_witness) {
          const verifyData = await this.self.identity.verifyJWS(json.proof)
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
        } else if (json.action === CoreTransactionTypes.announce_block) {
    
          /**
           * TODO: Calculate expected witness account
           */
          const expectedAccount = ""
          if (txInfo.account === expectedAccount) {
    
          }
    
          const data = await this.self.ipfs.dag.get(CID.parse(json.block_hash))
    
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
            ...json,
            ...txInfo,
            tx
          })
        } else if (json.action === CoreTransactionTypes.create_contract) {
          try {
            await this.self.contractEngine.contractDb.insertOne({
              id: tx.transaction_id,
              manifest_id: json.manifest_id,
              name: json.name,
              code: json.code,
              state_merkle: (await this.self.ipfs.object.new({ template: 'unixfs-dir' })).toString(),
              creation_tx: tx.transaction_id,
              created_at: tx.expiration
            } as Contract)
          } catch (err) {
            this.self.logger.error('not able to inject contract into the local database', tx.transaction_id)
          }
        } else if (json.action === CoreTransactionTypes.join_contract) {
          const commitment = await this.self.contractEngine.contractCommitmentDb.findOne({
            contract_id: json.contract_id,
            node_identity: json.node_identity
          })
    
          if (commitment === null) {
            try {
              await this.self.contractEngine.contractCommitmentDb.insertOne({
                id: tx.transaction_id,
                node_id: json.node_id,
                node_identity: json.node_identity,
                contract_id: json.contract_id,
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
        } else if (json.action === CoreTransactionTypes.leave_contract) {
          const commitment = await this.self.contractEngine.contractCommitmentDb.findOne({
            contract_id: json.contract_id,
            node_identity: json.node_identity
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
        } else if (json.action === CoreTransactionTypes.deposit) {
          if (txInfo.to === networks[this.self.config.get('network.id')].multisigAccount) {   
            const balanceController = { type: 'HIVE', authority: json.to ?? txInfo.account, conditions: []} as BalanceController
    
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
    
            if (json.contract_id) {
              deposit.contract_id = json.contract_id ?? null // limits the deposit on a specific contract
            }
    
            await this.balanceDb.insertOne(deposit);        
          }
          else {
            this.self.logger.warn(`received deposit (${json.action}), but the target account is not the multisig acc`, tx.transaction_id)
          }
        } else if (json.action === CoreTransactionTypes.withdraw_request) {
          let deposits = await this.getUserControlledBalances(txInfo.account);
    
          const currentBlock = {
            block_ref: '', // txInfo.block_ref TODO, block ref still needs to be passed down to processCoreTransaction -> txInfo 
            included_block: +txInfo.block_height
          } as BlockRef
    
          deposits = this.getDepositsWithMetConditions(deposits, currentBlock);
    
          const determinedDepositDrains = this.determineDepositDrains(deposits, json.amount);
    
          if (!determinedDepositDrains.isEnoughBalance) {
            this.self.logger.warn('withdraw request failed, not sufficient funds available, will not add to database', json)
          } else {
            const WITHDRAW_FAILED_BLOCK_DISTANCE = 200; // pla: this setting determines within how many blocks the withdraw should be executed by the multisig allowed nodes, if they fail to do so the withdraw is unlocked again and the balance will be treated like a deposit again
            const userBalanceController = { 
              type: 'HIVE', 
              authority: json.to ?? txInfo.account, 
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
              orig_balance: json.amount,
              active_balance: json.amount,
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
        } else if (json.action === CoreTransactionTypes.withdraw_finalization) {
          if (tx.from === networks[this.self.config.get('network.id')].multisigAccount) {
            const transferedCurrency = TransactionPoolService.parseFormattedAmount(txInfo.amount);
    
            const deposit = await this.balanceDb.findOne({ id: json.deposit_id })
    
            if (deposit.active_balance === transferedCurrency.amount) {
              await this.balanceDb.updateOne({ id: json.deposit_id }, 
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
        } else {
          //Unrecognized transaction
          this.self.logger.warn('not recognized tx type', json.action)
        }
      }
    
}