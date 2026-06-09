import { PrismaClient } from '@prisma/client';
import { buildSheetCsvUrl } from '../src/ad-sources/sheet-parser.util';

const prisma = new PrismaClient();

async function main() {
  const sources = await prisma.adDataSource.findMany({ where: { isActive: true } });
  console.log('sources:', sources.length);
  for (const s of sources) {
    const url = buildSheetCsvUrl(s.sheetId, s.mainTab);
    console.log('fetching', s.name, url);
    const res = await fetch(url);
    const text = await res.text();
    const firstLine = text.split('\n')[0];
    console.log('header:', firstLine.slice(0, 500));
    const headers = firstLine.toLowerCase().split(',');
    const hasStatus = headers.some((h) =>
      ['campaign_status', 'campaign status', '状态', '广告系列状态'].some((a) =>
        h.replace(/"/g, '').trim().includes(a),
      ),
    );
    console.log('has campaign_status column:', hasStatus);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
