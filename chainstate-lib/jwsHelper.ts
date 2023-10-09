import { DID, DagJWS } from "dids";
import { IPFSHTTPClient } from "kubo-rpc-client/dist/src";

export class JwsHelper {
    static async unwrapDagJws(dagJws: any, ipfs: IPFSHTTPClient, signer: DID) {
        const dag = await JwsHelper.verifyMultiDagJWS(dagJws, signer)

        return {
            ...dag,
            content: (await ipfs.dag.get((dag as any).link)).value
        }
    }

    static async verifyMultiDagJWS(dagJws: DagJWS, signer: DID) {
        let auths = [];

        for (let sig of dagJws.signatures) {
            const obj = {
                link: dagJws.link,
                signatures: [sig],
                payload: dagJws.payload,
            }
            const { kid } = await signer.verifyJWS(obj)

            auths.push(kid.split('#')[0])
        }

        return {
            payload: dagJws.payload,
            link: dagJws.link,
            auths
        }
    }
}
