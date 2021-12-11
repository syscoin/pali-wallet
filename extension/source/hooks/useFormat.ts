import format from 'date-fns/format';
import currency from 'currency.js';

const getYesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);

  return d;
};

export const useFormat = () => {
  const ellipsis = (str: any, start = 7, end = 4) => {
    if (typeof str !== 'string') {
      return str;
    }

    return `${str.substring(0, start)}...${str.substring(
      str.length - end,
      str.length
    )}`;
  };

  const formatDistanceDate = (timestamp: string) => {
    const formatStyle = 'M-d-yyyy';
    const today = new Date();
    const yesterday = getYesterday();
    const formatedDate = format(new Date(timestamp), formatStyle);

    if (formatedDate === format(today, formatStyle)) return 'Today';
    if (formatedDate === format(yesterday, formatStyle)) return 'Yesterday';
    
    return formatedDate;
  };

  const formatNumber = (num: number, min = 4, max = 4, maxSig = 12) => {
    return num.toLocaleString(navigator.language, {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      maximumSignificantDigits: maxSig,
    });
  };

  const formatCurrency = (number: string, precision: number) => {
    if (Number(number) < 1e-6) {
      number = Number(number).toFixed(precision);
    }

    return currency(number, { separator: ',', symbol: '', precision }).format();
  };

  //truncate
  const formatURL = (url: string, size = 30) => {
    if (url.length >= size) {
      return `${url.slice(0, size)}...`;
    }

    return url;
  };

  return {
    ellipsis,
    formatURL,
    formatCurrency,
    formatNumber,
    formatDistanceDate
  }
}