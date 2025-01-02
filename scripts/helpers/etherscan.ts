import axios from 'axios';

const EXPLORERS_APIS: { [id: string]: string } = {
    mainnet: 'https://api.etherscan.io/api',
    base: 'https://api.basescan.org/api',
    bsc: 'https://api.bscscan.com/api',
};

export const ErrAPINotFound = 'ErrAPINotFound';

export async function getAllLogsByEventAndFirstTopic(
    chain: string,
    address: string,
    eventTopic: string,
    dataTopic: string,
    apiKey: string
): Promise<any> {
    if (!(chain in EXPLORERS_APIS)) {
        throw ErrAPINotFound;
    }
    const baseUrl = EXPLORERS_APIS[chain];
    const params = {
        module: 'logs',
        action: 'getLogs',
        fromBlock: '0',
        toBlock: 'latest',
        address,
        topic0: eventTopic,
        topic0_1_opr: 'and',
        topic1: dataTopic,
        page: 1,
        offset: 1000,
        apikey: apiKey,
    };

    try {
        const response = await axios.get(baseUrl, { params });
        if (response.data.status === '1') {
            return response.data.result;
        } else {
            throw new Error(response.data.message || 'Error fetching logs');
        }
    } catch (error: any) {
        console.error('Error fetching logs:', error);
        throw error;
    }
}
