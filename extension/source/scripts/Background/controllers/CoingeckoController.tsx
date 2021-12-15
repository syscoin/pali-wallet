const { CoinGecko } = require('coingecko-api');
export interface ICoingeckoController {
  ping: () => Promise<any>;
}

const CoingeckoController = (): ICoingeckoController => {
  const CoinGeckoClient = new CoinGecko();

  // Check API server status.
  const ping = async () => {
    let data = await CoinGeckoClient.ping();
    return data;
  };

  /*
  Get the current price of any cryptocurrencies in any other supported currencies that you need.
  params: Object - Parameters to pass through to the request
  params.ids: Array|String - (Required) A single id or a list of coin ids to filter if you want specific results. Use coins.list() for a list of coin ids.
  params.vs_currencies: Array|String - [default: usd] - A single id or a list of ids. Use simple.supportedVsCurrencies() for a list of vsCurrency ids.
  params.include_24hr_vol: Boolean - [default: false] - To include 24hr volume.
  params.include_last_updated_at: Boolean - [default: false] - To include last_updated_at of price.
  */
 const simplePrice = async () => {
   
 }

  // Get cryptocurrency global data.
  const global = async () => {
    let data = await CoinGeckoClient.global();
  };

  /* List all coins with data (name, price, market, developer, community, etc) - paginated by 50.
  @params
  params: Object - Parameters to pass through to the request
  params.order: String - Order results by CoinGecko.ORDER[*]
  params.per_page: Number - Total results per page
  params.page: Number - Page through results
  params.localization: Boolean [default: true] - Set to false to exclude localized languages in response
  params.sparkline: Boolean [default: false] - Include sparkline 7 days data
  */
  const coinsAll = async () => {
    let data = await CoinGeckoClient.coins.all();
  };

  // Use this to obtain all the coins’ id in order to make API calls
  const coinsList = async () => {
    let data = await CoinGeckoClient.coins.list();
  }

  /*
  Use this to obtain all the coins market data (price, market cap, volume).
  params: Object - Parameters to pass through to the request
  params.order: String - Order results by CoinGecko.ORDER[*]
  params.per_page: Number - Total results per page
  params.page: Number - Page through results
  params.localization: Boolean [default: true] - Set to false to exclude localized languages in response
  params.sparkline: Boolean [default: false] - Include sparkline 7 days data
  params.vs_currency: String [default: usd] - The target currency of market data (usd, eur, jpy, etc.)
  params.ids: Array|String - List of coin id to filter if you want specific results
  */
 const coinsMarkets = async () => {
  let data = await CoinGeckoClient.coins.markets();
 }

 /*
 Get current data (name, price, market, … including exchange tickers) for a coin.
 coinId: String - (Required) The coin id (can be obtained from coins.list()) eg. bitcoin
 params: Object - Parameters to pass through to the request
 params.tickers: Boolean - [default: true] - Include ticker data
 params.market_data: Boolean - [default: true] - Include market data
 params.community_data: Boolean - [default: true] - Include community data
 params.developer_data: Boolean - [default: true] - Include developer data
 params.localization: Boolean [default: true] - Set to false to exclude localized languages in response
 params.sparkline: Boolean [default: false] - Include sparkline 7 days data
 */
const coinsFetch = async () => {
  let data = await CoinGeckoClient.coins.fetch('bitcoin', {});
}

/*
Get coin tickers (paginated to 100 items).
coinId: String - (Required) The coin id (can be obtained from coins.list()) eg. bitcoin
params: Object - Parameters to pass through to the request
params.page: Number - Page through results
params.exchange_ids: Array|String - Filter tickers by exchange_ids (can be obtained from exchanges.list()) eg. binance
params.order: String - [default: trust_score_desc] - Order results by CoinGecko.ORDER.TRUST_SCORE_DESC or CoinGecko.ORDER.VOLUME_DESC
*/
const coinsFectchTickers = async () => {
  let data = await CoinGeckoClient.coins.fetchTickers('bitcoin');
}
  return {
    ping,
  };
};

export default CoingeckoController;
