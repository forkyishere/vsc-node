import { CID } from "kubo-rpc-client/dist/src";
import { ChainStateLib } from "./ChainStateLib";
import { ContractInput, ContractOutput, TransactionConfirmed, TransactionDbStatus, TransactionDbType, VSCTransactionTypes } from "./types/vscTransactions";
import { JwsHelper } from "./jwsHelper";

export class ChainParserVSC {
  private self: ChainStateLib;

  constructor(self) {
    this.self = self;
  }

  async processVSCBlockTransaction(tx: TransactionConfirmed, blockHash: string) {
    await this.self.transactionPool.findOneAndUpdate(
      {
        id: tx.id.toString(),
      },
      {
        $set: {
          status: TransactionDbStatus.included,
          included_in: blockHash.toString(),
        },
      },
    )

    if (tx.op === VSCTransactionTypes.call_contract) {
      // if (this.self.config.get('witness.enabled')) {

      // pla: the section below doesnt work when no contract can be retrieved from the local ipfs node. 
      // what to do when not beeing able to receive contract object? same for VSCTransactionTypes.contract_output
      let auths = []
      try {
        console.log('parsing tx', tx)
        const transactionRaw: ContractInput = (await this.self.ipfs.dag.get(tx.id as any)).value
        const { content, auths: authsOut } = await JwsHelper.unwrapDagJws(transactionRaw, this.self.ipfs, this.self.identity)
        auths = authsOut;
        console.log('tx content', content)
        const alreadyExistingTx = await this.self.transactionPool.findOne({
          id: tx.id.toString()
        })

        let local;
        if (alreadyExistingTx) {
          local = alreadyExistingTx.local
        } else {
          local = false;
        }

        await this.self.transactionPool.findOneAndUpdate({
          id: tx.id.toString(),
        }, {
          $set: {
            account_auth: auths[0],
            op: tx.op,
            lock_block: null,
            status: TransactionDbStatus.included,
            first_seen: new Date(),

            type: TransactionDbType.input,
            included_in: blockHash,

            executed_in: null,
            output: null,

            local,
            accessible: true,
            headers: {
              contract_id: content.tx.contract_id
            }
          }
        }, {
          upsert: true
        })
      } catch (e) {
        console.log(e)
        this.self.logger.error("not able to receive contract from local ipfs node ", tx.id)
      }

      // }
    } else if (tx.op === VSCTransactionTypes.contract_output) {
      const transactionRaw: ContractOutput = (await this.self.ipfs.dag.get(tx.id as any)).value
      const { content, auths } = await JwsHelper.unwrapDagJws(transactionRaw, this.self.ipfs, this.self.identity)

      this.self.logger.debug("contract output received", content)

      //Do validation of executor pool

      await this.self.transactionPool.findOneAndUpdate({
        id: tx.id.toString(),
      }, {
        $set: {
          account_auth: auths[0],
          op: tx.op,
          lock_block: null,
          status: TransactionDbStatus.confirmed,
          first_seen: new Date(),

          type: TransactionDbType.core,
          included_in: blockHash,
          executed_in: blockHash,
          output: null,

          local: false,
          accessible: true,
          output_actions: content.tx.chain_actions
        }
      }, {
        upsert: true
      })

      await this.self.contractDb.findOneAndUpdate({
        id: content.tx.contract_id
      }, {
        $set: {
          state_merkle: content.tx.state_merkle
        }
      })

      // update parent tx (call contract)

      await this.self.transactionPool.findOneAndUpdate({
        id: content.tx.parent_tx_id,
      }, {
        $set: {
          status: TransactionDbStatus.confirmed,
          executed_in: blockHash
        }
      });
    }
    else if (tx.op === VSCTransactionTypes.update_contract) {
      // pla: TBD update general stuff in regards to the contract... description etc.
    }
    else if (tx.op === VSCTransactionTypes.transferFunds) {
      // in here update the balance sheet of a contract, do the calculation on top of the local state, then check the supplied hash if they are equal
    }
  }

  /**
 * Verifies content in mempool is accessible
 */
  async verifyMempool() {
    const txs = await this.self.transactionPool
      .find({
        status: TransactionDbStatus.unconfirmed,
      })
      .toArray()
    for (let tx of txs) {
      try {
        const out = await this.self.ipfs.dag.get(CID.parse(tx.id), {
          timeout: 10 * 1000,
        })
        await this.self.transactionPool.findOneAndUpdate(
          {
            _id: tx._id,
          },
          {
            $set: {
              accessible: true,
            },
          },
        )
      } catch { }
    }
  }
}