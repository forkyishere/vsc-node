import dhive, { PrivateKey } from '@hiveio/dhive'
import { TransactionDbStatus, VSCTransactionTypes } from '../../chainstate-lib/types/vscTransactions'
import { CoreTransactionTypes } from '../../chainstate-lib/types/coreTransactions'
import { HiveClient } from '../../chainstate-lib/fastStreamHIVE'
import { BlockRecord } from '../../chainstate-lib/types/blockData'

export class BlockProducer {
  hiveKey: dhive.PrivateKey

  async createBlock() {
    const txs = await this.self.transactionPool.transactionPool
      .find({
        status: TransactionDbStatus.unconfirmed,
        accessible: true,
      })
      .toArray()
    this.self.logger.debug('creating block with following unconfirmed tx', txs)

    if (txs.length === 0) {
      this.self.logger.info('not creating block, no tx found')
      return;
    }

    let state_updates = {}
    // let txHashes = []
    let transactions = []
    for (let txContainer of txs) {
      //Verify CID is available
      try {
        const signedTransaction: DagJWS = (await this.self.ipfs.dag.get(CID.parse(txContainer.id))).value
        const { payload, kid } = await this.self.identity.verifyJWS(signedTransaction)
        const [did] = kid.split('#')
        const content = (await this.self.ipfs.dag.get((signedTransaction as any).link as CID)).value

        this.self.logger.debug('signed tx', signedTransaction as any)
        this.self.logger.debug('including tx in block', txContainer, payload)

        if (content.op === VSCTransactionTypes.call_contract) {
          // pla: just pass on the tx
        } else if (content.op === VSCTransactionTypes.contract_output) {
          // pla: combine other executors contract invokation results in multisig and create the contract_output tx
        } else if (content.op === VSCTransactionTypes.update_contract) {

        }

        // txHashes.push({
        //   op: txContainer.op,
        //   id: CID.parse(txContainer.id),
        //   lock_block: txContainer.lock_block,
        // })

        transactions.push({
          op: txContainer.op,
          id: CID.parse(txContainer.id),
          type: TransactionDbType.input,
        })
      } catch (ex) {
        console.log(ex)
        this.self.logger.error('error while attempting to create block', ex)
      }
    }

    const previousBlock = await this.blockHeaders.findOne(
      {},
      {
        sort: {
          height: -1,
        },
      },
    )

    const previous = previousBlock ? CID.parse(previousBlock.id) : null

    let block: BlockRecord = {
      __t: 'vsc-block',
      __v: '0.1',
      /**
       * State updates
       * Calculated from transactions output(s)
       */
      state_updates,
      txs: transactions,
      previous: previous,
      timestamp: new Date().toISOString(),
    }
    const blockHash = await this.self.ipfs.dag.put(block)
    this.self.logger.debug('published block on ipfs', block, blockHash)

    try {
      const result = await HiveClient.broadcast.json(
        {
          required_auths: [],
          required_posting_auths: [process.env.HIVE_ACCOUNT],
          id: 'vsc.announce_block',
          json: JSON.stringify({
            action: CoreTransactionTypes.announce_block,
            block_hash: blockHash.toString(),
            net_id: this.self.config.get('network.id'),
          }),
        },
        this.hiveKey,
      )
      this.self.logger.debug('published block on hive', blockHash)
    } catch (ex) {
      this.self.logger.error('error while publishing block to hive', ex)
    }
  }


  async start() {
    if (this.self.mode !== 'lite') {

      if (process.env.HIVE_ACCOUNT_POSTING) {
        this.hiveKey = PrivateKey.fromString(process.env.HIVE_ACCOUNT_POSTING)
      }

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