import {Link} from 'react-router';
import {Image, Pagination} from '@shopify/hydrogen';
import {urlWithTrackingParams, type RegularSearchReturn} from '~/lib/search';
import {T, Branch} from 'gt-react';
import {useCatalog} from '~/lib/useCatalog';
import {LocalizedMoney} from './LocalizedMoney';

type SearchItems = RegularSearchReturn['result']['items'];
type PartialSearchResult<ItemType extends keyof SearchItems> = Pick<
  SearchItems,
  ItemType
> &
  Pick<RegularSearchReturn, 'term'>;

type SearchResultsProps = RegularSearchReturn & {
  children: (args: SearchItems & {term: string}) => React.ReactNode;
};

export function SearchResults({
  term,
  result,
  children,
}: Omit<SearchResultsProps, 'error' | 'type'>) {
  if (!result?.total) {
    return null;
  }

  return children({...result.items, term});
}

SearchResults.Articles = SearchResultsArticles;
SearchResults.Pages = SearchResultsPages;
SearchResults.Products = SearchResultsProducts;
SearchResults.Empty = SearchResultsEmpty;

function SearchResultsArticles({
  term,
  articles,
}: PartialSearchResult<'articles'>) {
  if (!articles?.nodes.length) {
    return null;
  }

  return (
    <div className="search-result">
      <T>
        <h2>Articles</h2>
      </T>
      <div>
        {articles?.nodes?.map((article) => {
          const articleUrl = urlWithTrackingParams({
            baseUrl: `/blogs/${article.blog.handle}/${article.handle}`,
            trackingParams: article.trackingParameters,
            term,
          });

          return (
            <div className="search-results-item" key={article.id}>
              <Link prefetch="intent" to={articleUrl}>
                {article.title}
              </Link>
            </div>
          );
        })}
      </div>
      <br />
    </div>
  );
}

function SearchResultsPages({term, pages}: PartialSearchResult<'pages'>) {
  if (!pages?.nodes.length) {
    return null;
  }

  return (
    <div className="search-result">
      <T>
        <h2>Pages</h2>
      </T>
      <div>
        {pages?.nodes?.map((page) => {
          const pageUrl = urlWithTrackingParams({
            baseUrl: `/pages/${page.handle}`,
            trackingParams: page.trackingParameters,
            term,
          });

          return (
            <div className="search-results-item" key={page.id}>
              <Link prefetch="intent" to={pageUrl}>
                {page.title}
              </Link>
            </div>
          );
        })}
      </div>
      <br />
    </div>
  );
}

function SearchResultsProducts({
  term,
  products,
}: PartialSearchResult<'products'>) {
  const catalog = useCatalog();
  if (!products?.nodes.length) {
    return null;
  }

  return (
    <div className="search-result">
      <T>
        <h2>Products</h2>
      </T>
      <Pagination connection={products}>
        {({nodes, isLoading, NextLink, PreviousLink}) => {
          const ItemsMarkup = nodes.map((product) => {
            const title = catalog(product.id, 'title', product.title);
            const productUrl = urlWithTrackingParams({
              baseUrl: `/products/${product.handle}`,
              trackingParams: product.trackingParameters,
              term,
            });

            const price = product?.selectedOrFirstAvailableVariant?.price;
            const image = product?.selectedOrFirstAvailableVariant?.image;

            return (
              <div className="search-results-item" key={product.id}>
                <Link prefetch="intent" to={productUrl}>
                  {image && <Image data={image} alt={title} width={50} />}
                  <div>
                    <p>{title}</p>
                    <small>{price && <LocalizedMoney data={price} />}</small>
                  </div>
                </Link>
              </div>
            );
          });

          return (
            <div>
              <div>
                <T>
                  <PreviousLink>
                    <Branch
                      branch={isLoading.toString()}
                      true={<>Loading…</>}
                      false={<span>↑ Load previous</span>}
                    />
                  </PreviousLink>
                </T>
              </div>
              <div>
                {ItemsMarkup}
                <br />
              </div>
              <div>
                <T>
                  <NextLink>
                    <Branch
                      branch={isLoading.toString()}
                      true={<>Loading…</>}
                      false={<span>Load more ↓</span>}
                    />
                  </NextLink>
                </T>
              </div>
            </div>
          );
        }}
      </Pagination>
      <br />
    </div>
  );
}

function SearchResultsEmpty() {
  return (
    <T>
      <p>No results. Try a different search.</p>
    </T>
  );
}
