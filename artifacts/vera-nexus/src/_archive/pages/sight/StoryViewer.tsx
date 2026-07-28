import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { NewsArticle } from '../../lib/sight-data';

interface StoryViewerProps {
  article: NewsArticle;
  onClose: () => void;
  allArticles: NewsArticle[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}

export function StoryViewer({
  article,
  onClose,
  allArticles,
  currentIndex,
  onNavigate,
}: StoryViewerProps) {
  const [slideIndex, setSlideIndex] = useState(0);
  const slides = article.slides || [];
  const totalSlides = slides.length || 1;
  const [autoAdvance, setAutoAdvance] = useState(true);

  useEffect(() => {
    if (!autoAdvance || !slides.length) return;
    const timer = setTimeout(() => {
      if (slideIndex < slides.length - 1) {
        setSlideIndex(slideIndex + 1);
      } else {
        setAutoAdvance(false);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [slideIndex, autoAdvance, slides.length]);

  const handlePrevStory = () => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
    setSlideIndex(0);
  };

  const handleNextStory = () => {
    if (currentIndex < allArticles.length - 1) onNavigate(currentIndex + 1);
    setSlideIndex(0);
  };

  const handlePrevSlide = () => {
    setAutoAdvance(false);
    setSlideIndex(Math.max(0, slideIndex - 1));
  };

  const handleNextSlide = () => {
    setAutoAdvance(false);
    if (slideIndex < slides.length - 1) {
      setSlideIndex(slideIndex + 1);
    }
  };

  const currentSlide = slides[slideIndex] || { title: article.title, body: article.blurb };

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      {/* Full-bleed background with scrim */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url('${article.img}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {/* Dark gradient scrim */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/60 to-black/80" />
      </div>

      {/* Content overlay */}
      <div className="relative z-10 w-full h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--mint)]">
              {article.tagLabel}
            </span>
            <span className="text-[10px] font-mono text-[var(--dim)]">{article.source}</span>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:text-[var(--dim)] transition-colors"
            aria-label="Close story"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Center content */}
        <div className="flex-1 flex flex-col items-center justify-center px-12 py-8 min-h-0">
          <div className="max-w-2xl w-full">
            <h1 className="font-syne text-5xl font-bold text-white mb-6 leading-tight text-balance">
              {slideIndex === 0 ? article.hook || article.title : currentSlide.title}
            </h1>
            <p className="text-lg text-gray-200 leading-relaxed text-pretty">
              {slideIndex === 0 ? article.blurb : currentSlide.body}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-white/10 shrink-0">
          <div
            className="h-full bg-white transition-all duration-300"
            style={{ width: `${((slideIndex + 1) / (totalSlides + 1)) * 100}%` }}
          />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between px-6 py-5 shrink-0 bg-black/40">
          {/* Left navigation */}
          <div className="flex items-center gap-4">
            {currentIndex > 0 && (
              <button
                onClick={handlePrevStory}
                className="p-2 hover:bg-white/10 rounded transition-colors"
                aria-label="Previous story"
              >
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
            )}
            <span className="text-xs font-mono text-[var(--dim)]">
              {currentIndex + 1} / {allArticles.length}
            </span>
          </div>

          {/* Slide indicators */}
          <div className="flex gap-2">
            {Array.from({ length: totalSlides + 1 }).map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  setSlideIndex(i - 1);
                  setAutoAdvance(false);
                }}
                className={`h-2 rounded-full transition-all ${
                  i === slideIndex + 1
                    ? 'w-6 bg-white'
                    : 'w-2 bg-white/30 hover:bg-white/50'
                }`}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>

          {/* Right navigation: slides first, then stories */}
          <div className="flex items-center gap-4">
            {slides.length > 0 && (
              <button
                onClick={handlePrevSlide}
                disabled={slideIndex === 0}
                className="p-2 hover:bg-white/10 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Previous slide"
              >
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
            )}
            {/* Single right arrow: next slide if available, otherwise next story */}
            {(slides.length > 0 || currentIndex < allArticles.length - 1) && (
              <button
                onClick={() => {
                  if (slides.length > 0 && slideIndex < slides.length - 1) {
                    handleNextSlide();
                  } else if (currentIndex < allArticles.length - 1) {
                    handleNextStory();
                  }
                }}
                disabled={slides.length === 0 && currentIndex >= allArticles.length - 1}
                className="p-2 hover:bg-white/10 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label={slides.length > 0 ? 'Next slide' : 'Next story'}
              >
                <ChevronRight className="w-5 h-5 text-white" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
