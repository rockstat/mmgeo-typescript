import { readFileSync } from 'fs'


const handleRow = (data: string): any => {
  const res: { [k: string]: any } = {};
  let resIp = undefined;

  const row = JSON.parse(data);
  if (typeof row['ip'] == 'object' && row['ip']) {
    resIp = row['ip']['v4']
  }
  res['src'] = []
  if (typeof row['src'] == 'object' && typeof row['src']['name'] == 'object') {
    for (let v of row['src']['name']) {
      res['src'].push(v)
    }
  }

  res['cve'] = []
  if (typeof row['cve'] == 'object') {
    for (let v of row['cve']) {
      res['cve'].push(v)
    }
  }
  res['tags'] = []
  if (typeof row['tags'] == 'object' && typeof row['tags']['str'] == 'object') {
    for (let v of row['tags']['str']) {
      res['tags'].push(v)
    }
  }
  res['threat'] = []
  if (typeof row['threat'] == 'object') {
    for (let v of row['threat']) {
      res['threat'].push(v)
    }
  }
  res['fp'] = {}
  if (typeof row['fp'] == 'object') {
    for (let [k, v] of Object.entries(row['fp'])) {
      res['fp'][k] = v;
    }
  }

  if (typeof row['asn'] == 'object') {
    res['asn_org'] = row['asn']['org'];
    res['asn_cloud'] = row['asn']['cloud'];
  }

  res['score'] = {}
  if (typeof row['score'] == 'object') {
    for (let [k, v] of Object.entries(row['score'])) {
      res['score'][k] = v;
    }
  }
  return [resIp, res];
}


export const loadDB = (file: string) => {
  const fbuff = readFileSync(file, { encoding: 'utf-8' });
  const data = new Map();
  for (let line of fbuff.split('\n')) {
    line = line.trim()
    if (line) {
      let [rowIp, row] = handleRow(line);
      if (rowIp && typeof row == 'object') {
        data.set(rowIp, row);
      }

    }
  }
  return data;
}
