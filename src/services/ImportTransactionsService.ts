import { getCustomRepository, getRepository, In } from 'typeorm';

import csvParse from 'csv-parse';
import fs from 'fs';

import TransactionsRepository from '../repositories/TransactionsRepository';

import Transaction from '../models/Transaction';
import Category from '../models/Category';

interface ImportTransactionCSV {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionRepository = getCustomRepository(TransactionsRepository);
    const categoriesRepository = getRepository(Category);

    const readCSVStream = fs.createReadStream(filePath);

    const parseStream = csvParse({
      from_line: 2,
      ltrim: true,
      rtrim: true,
    });

    const parseCSV = readCSVStream.pipe(parseStream);

    const transactionLines: ImportTransactionCSV[] = [];
    const categoryLines: string[] = [];

    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value) return;

      categoryLines.push(category);
      transactionLines.push({ title, type, value, category });
    });

    await new Promise(resolve => parseCSV.on('end', resolve));

    const databaseCategories = await categoriesRepository.find({
      where: {
        title: In(categoryLines),
      },
    });

    const databaseCategoryTitles = databaseCategories.map(
      (category: Category) => category.title,
    );

    const addCategoryTitles = categoryLines
      .filter(category => !databaseCategoryTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    const createdCategories = categoriesRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    await categoriesRepository.save(createdCategories);

    const allCategories = [...createdCategories, ...databaseCategories];

    const createdTransactions = transactionRepository.create(
      transactionLines.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: allCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    await transactionRepository.save(createdTransactions);

    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
