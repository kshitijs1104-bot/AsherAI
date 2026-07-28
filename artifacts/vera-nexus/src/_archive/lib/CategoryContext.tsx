import React, { createContext, useContext, useState } from 'react';

type Category = 'all' | 'technology' | 'finance' | 'markets' | 'health';

interface CategoryContextType {
  category: Category;
  setCategory: (cat: Category) => void;
  tier: 'Personal' | 'Enterprise';
  setTier: (tier: 'Personal' | 'Enterprise') => void;
}

const CategoryContext = createContext<CategoryContextType | undefined>(undefined);

export function CategoryProvider({ children }: { children: React.ReactNode }) {
  const [category, setCategory] = useState<Category>('all');
  const [tier, setTier] = useState<'Personal' | 'Enterprise'>('Personal');
  return (
    <CategoryContext.Provider value={{ category, setCategory, tier, setTier }}>
      {children}
    </CategoryContext.Provider>
  );
}

export function useCategory() {
  const context = useContext(CategoryContext);
  if (!context) throw new Error('useCategory must be used within a CategoryProvider');
  return context;
}
