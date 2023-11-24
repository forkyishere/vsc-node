// network class

export class Network {
    public genesisDay: number;
    public roundLength: number;
    public totalRounds: number;
    public multisigAccount?: string;

    constructor(genesisDay: number, roundLength: number, totalRounds: number, multisigAccount?: string) {
        this.genesisDay = genesisDay;
        this.roundLength = roundLength;
        this.totalRounds = totalRounds;
        this.multisigAccount = multisigAccount;
    }
}