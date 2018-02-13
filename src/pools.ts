const pools = {};

addPool('159.65.34.150', 'trtl', 'USA');
addPool('207.154.243.223', 'trtl', 'EUR');
addPool('207.154.243.223', 'xao', 'USA')

export default pools;

function addPool(host, coin, region) {
  pools[host] = {host, coin, region};
}