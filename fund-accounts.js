#!/usr/bin/env node

/**
 * Takes a private key of an account with funds to be distributed.
 * Takes a gas amount (e.g. in order to fund 100 txs costing 500k gas each, put 50000000 here).
 * Calculates the amount of native coins based on the network gas price and 
 * 
 * ./app.js <network> <gas amount> <receiver> ["diff"]
 *  If the optional argument "diff" is provided, only the missing amount (if any) is sent to the receiver.
 * 
 * ENV vars (can be provided via .env):
 * - PRIVATE_KEY
 * - RPC (not needed if PROVIDER_URL_TEMPLATE is provided)
 * - DRY_RUN: if set, no tx is sent
 */

require('dotenv').config();
const e = require("ethers");
const sfMeta = require("@superfluid-finance/metadata");
const axios = require('axios');

const networkName = process.argv[2];
const gasAmount = process.argv[3];
const receiver = process.argv[4];
const diffMode = process.argv[5] !== undefined && process.argv[5] === 'diff';

console.log(`requested: network ${networkName}, gas amount: ${gasAmount} for receiver: ${receiver} ${diffMode ? ' only difference' : ''}`);

if (!networkName || !gasAmount || !receiver) {
    throw new Error('Usage: ./app.js <network> <gas amount> <receiver> ["diff"]');
}

const network = sfMeta.getNetworkByName(networkName);
const nativeTokenSymbol = network?.nativeTokenSymbol;

(async function main() {
    const rpcUrl = process.env.RPC || process.env.PROVIDER_URL_TEMPLATE.replace('{{NETWORK}}', networkName);

    const provider = new e.providers.JsonRpcProvider(rpcUrl);
    console.log(`Connected to chain with id ${(await provider.getNetwork()).chainId}`);

    const usdPrice = nativeTokenSymbol !== undefined ? await tryGetCoinGeckoPrice(nativeTokenSymbol) : undefined;
    console.log(`1 ${nativeTokenSymbol} = ${usdPrice}`);

    const wallet = new e.Wallet(process.env.PRIVATE_KEY, provider);
    const walletBalanceEth = e.utils.formatEther(await wallet.getBalance());
    console.log(`funder's address: ${wallet.address}, balance: ${walletBalanceEth} ${nativeTokenSymbol} (${getFormattedUsdAmount(walletBalanceEth, usdPrice)})`);

    const gasPrice = await provider.getGasPrice();
    const gasPriceGwei = e.utils.formatUnits(gasPrice, 'gwei');
    const gasCost = gasPrice.mul(gasAmount);
    const gasCostEth = e.utils.formatEther(gasCost);

    console.log(`Gas price: ${gasPriceGwei} gwei`);
    console.log(`Estimated Cost on ${networkName} at ${gasPriceGwei} gwei: ${gasCostEth} ${nativeTokenSymbol} (${getFormattedUsdAmount(gasCostEth, usdPrice)})`);

    const funderBalance = await wallet.getBalance();

    if (funderBalance.lt(gasCost)) {
        const missingAmountEth = e.utils.formatEther(gasCost.sub(funderBalance));
        console.error(`### Funder's balance ${e.utils.formatEther(funderBalance)} is not enough, missing amount: ${missingAmountEth} ${nativeTokenSymbol} (${getFormattedUsdAmount(missingAmountEth, usdPrice)}) ###})`);
    } else {
        const amountToSend = diffMode ? gasCost.sub(await provider.getBalance(receiver)) : gasCost;

        if (amountToSend.lte(0)) {
            console.log(`Receiver's balance is enough to cover requested amount ${gasCostEth} ${nativeTokenSymbol}`);
        } else {
            const amountToSendEth = e.utils.formatEther(amountToSend);
            console.log(`Amount to send to receiver: ${amountToSendEth} ${nativeTokenSymbol} (${getFormattedUsdAmount(amountToSendEth, usdPrice)})`);
            if (process.env.DRY_RUN !== undefined) {
                console.log("Dry run, not sending the tx");
            } else {
                console.log("!!! Waiting 10 seconds before sending. Interrupt with Ctrl+C if you don't want to proceed !!!")
                await delay(10000);
                // send the funds
                const tx = await wallet.sendTransaction({
                    to: receiver,
                    value: gasCost,
                    gasPrice: gasPrice
                });
                console.log(`Sent tx: ${tx.hash}...`);
                await tx.wait();
                console.log("Tx confirmed");
            }
        }
    }
    console.log("================================================");
})();

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function tryGetCoinGeckoPrice(coinSymbol) {
    const symbolToCoinId = {
        "ETH": "ethereum",
        "MATIC": "matic-network",
        "CELO": "celo",
        "AVAX": "avalanche-2",
        "xDAI": "xdai",
        "BNB": "binancecoin"
    };
    try {
        const coinId = symbolToCoinId[coinSymbol];
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
            params: {
                ids: coinId,
                vs_currencies: 'usd'
            }
        });
        return response.data[coinId].usd;
    } catch (error) {
        console.error(`Error fetching price:`, error.message);
    }
}

function getFormattedUsdAmount(coinAmount, usdPrice) {
    return usdPrice === undefined ?
        "$?":
        `$${(coinAmount * usdPrice).toFixed(2)}`;
}