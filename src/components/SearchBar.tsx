'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';
import { debounce } from '@/lib/utils';

interface SearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
  placeholder?: string;
  initialValue?: string;
}

export function SearchBar({ onSearch, loading = false, placeholder = "Search anime...", initialValue = '' }: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);

  // Update query when initialValue changes
  React.useEffect(() => {
    setQuery(initialValue);
  }, [initialValue]);

  const debouncedSearch = React.useMemo(
    () => debounce((searchQuery: string) => {
      // Only trigger search if query is empty or has at least 2 characters
      if (searchQuery.trim().length === 0 || searchQuery.trim().length >= 2) {
        onSearch(searchQuery);
      }
    }, 1000),
    [onSearch]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    debouncedSearch(value);
  };

  const handleClear = () => {
    setQuery('');
    onSearch('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit} className="relative max-w-2xl mx-auto">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
        <Input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={handleInputChange}
          className="pl-10 pr-20 h-12 bg-gray-900/50 border-gray-700 focus:border-blue-500 text-white placeholder:text-gray-400"
          disabled={loading}
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-12 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={loading || !query.trim()}
          className="absolute right-1 top-1/2 transform -translate-y-1/2 h-10 bg-blue-600 hover:bg-blue-700"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            'Search'
          )}
        </Button>
      </div>
    </form>
  );
}
