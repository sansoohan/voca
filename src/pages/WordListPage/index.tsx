// pages/WordListPage/index.tsx
import { WordListPageProvider } from './Provider';
import WordListPageRenderer from './Renderer';

export const WordListPage = () => {
  return (
    <WordListPageProvider>
      <WordListPageRenderer />
    </WordListPageProvider>
  );
};
