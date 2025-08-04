# Pali Wallet Loading Strategy

## Overview

This document outlines the standardized loading state management strategy for the Pali Wallet application. The goal is to provide instant feedback with a non-intrusive overlay that darkens the screen and prevents interactions, with an optional spinner for longer operations.

## Key Components

### 1. PageLoadingOverlay Component

- **Location**: `source/components/Loading/PageLoadingOverlay.tsx`
- **Purpose**: Provides immediate visual feedback with minimal disruption
- **Features**:
  - Shows instantly when loading starts (no delay)
  - Darkens screen with subtle backdrop blur
  - Blocks all user interactions
  - Shows spinner only after 500ms for longer operations
  - Displays slow connection warning after 5 seconds

### 2. usePageLoadingState Hook

- **Location**: `source/hooks/usePageLoadingState.tsx`
- **Purpose**: Centralized loading state management
- **Features**:
  - Tracks navigation changes
  - Monitors network switching and account switching
  - Supports additional loading conditions per page
  - Returns raw loading state and message
  - All timing handled by PageLoadingOverlay component

### 3. AppLayout Integration

- **Location**: `source/components/Layout/AppLayout.tsx`
- **Purpose**: Connects loading state to overlay display
- **Behavior**:
  - Uses usePageLoadingState to get loading status
  - Passes state to PageLoadingOverlay for display
  - Header and banner remain accessible above overlay

### 4. Suspense Boundaries

- **Purpose**: Required by React for lazy-loaded components
- **Implementation**:
  - Use minimal transparent fallback: `<div style={{ opacity: 0 }}>Loading...</div>`
  - AppLayout handles the actual loading display
  - Prevents duplicate loading indicators

## Loading States

### Global Loading States

These are automatically tracked across the entire app:

- Network switching (`networkStatus === 'switching'`)
- Account switching (`isSwitchingAccount`)
- Navigation changes (brief loading during route transitions)

### Page-Specific Loading States

Individual pages can add their own loading conditions:

```typescript
const { isLoading, message } = usePageLoadingState([
  isLoadingData,
  !requiredData,
  isFetchingAssets,
]);
```

## Implementation Guidelines

### 1. For Regular Pages

Pages that are part of the main app navigation should:

- Let AppLayout handle the loading overlay automatically
- Continue rendering content (it will be darkened by overlay)
- Use skeleton loaders for partial data loading within the page

Example:

```typescript
export const MyPage = () => {
  const { data, isLoading } = useData();
  const { isLoading: pageIsLoading } = usePageLoadingState([isLoading, !data]);

  // No need to return null - overlay handles loading display
  return (
    <div>{isLoading ? <SkeletonLoader /> : <DataDisplay data={data} />}</div>
  );
};
```

### 2. For External/Popup Pages

External transaction pages (opened in popup windows) should:

- Keep their existing `LoadingComponent` usage
- Manage their own loading states
- Not rely on AppLayout's overlay

### 3. For Skeleton Loaders

Use skeleton loaders for:

- List items loading (transactions, assets)
- Balance displays during refresh
- Any partial content that can load independently

Example:

```typescript
{
  isLoadingBalance ? (
    <SkeletonLoader width="200px" height="48px" />
  ) : (
    <BalanceDisplay balance={balance} />
  );
}
```

### 4. For Lazy-Loaded Components

When using React.lazy() for code splitting:

- Wrap lazy components in Suspense boundaries
- Use minimal transparent fallback
- Let AppLayout handle the actual loading display

Example:

```typescript
const LazyComponent = lazy(() => import('./MyComponent'));

// In router or parent component:
<Suspense fallback={<div style={{ opacity: 0 }}>Loading...</div>}>
  <LazyComponent />
</Suspense>;
```

## Loading UX Flow

1. **After 150ms**: Spinner appears for immediate feedback (no screen darkening)
2. **After 500ms**: Dark overlay appears with backdrop blur if still loading
3. **After 5s**: Slow connection warning appears

This provides instant visual feedback with the spinner, while delaying screen changes until needed.

## Best Practices

1. **Instant Feedback**: Overlay shows immediately for all loading states
2. **Non-Intrusive**: Dark overlay is subtle, not jarring
3. **Progressive Enhancement**: Spinner delayed even further (700ms total)
4. **Prevent Interactions**: Overlay blocks all clicks during loading
5. **Skeleton First**: Use skeletons for partial content loading
6. **Minimal Suspense**: Use transparent Suspense fallbacks

## Migration Checklist

When updating a component to use the new loading strategy:

- [ ] Remove `LoadingComponent` imports if not external
- [ ] Remove `isDelayedLoading` checks and `return null` statements
- [ ] Let components render normally (overlay will handle loading)
- [ ] Add skeleton loaders for partial content
- [ ] Test loading states with network throttling
- [ ] Verify overlay appears immediately
- [ ] Update Suspense fallbacks to be minimal/transparent

## Key Features

- **Single source of timing**: PageLoadingOverlay handles all delays and transitions
- **Instant feedback**: Spinner appears immediately (50ms) without screen changes
- **Progressive darkening**: Overlay only appears if loading takes longer (250ms)
- **Header remains accessible**: Overlay only covers content area below header
- **Consistent background**: No jarring color changes during quick operations
- **Non-intrusive**: Clean spinner with delayed screen interaction blocking

## Common Patterns

### Data Fetching Page

```typescript
const { data, isLoading, error } = useFetch();
const { isLoading: pageLoading } = usePageLoadingState([isLoading]);

// Component renders normally - overlay handles loading
if (error) return <ErrorComponent />;
return <div>{isLoading ? <DataSkeleton /> : <DataDisplay data={data} />}</div>;
```

### Form Submission Page

```typescript
const [isSubmitting, setIsSubmitting] = useState(false);
const { isLoading } = usePageLoadingState([isSubmitting]);

const handleSubmit = async () => {
  setIsSubmitting(true);
  try {
    await submitData();
    navigate('/success');
  } finally {
    setIsSubmitting(false);
  }
};

// Form renders normally - overlay prevents interactions during submission
return <Form onSubmit={handleSubmit} />;
```

### List with Skeletons

```typescript
const { items, isLoadingItems } = useItems();

return (
  <div>
    {isLoadingItems ? (
      <ListSkeleton />
    ) : (
      items.map((item) => <ListItem key={item.id} {...item} />)
    )}
  </div>
);
```
