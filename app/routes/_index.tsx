import {Suspense} from 'react';
import {Await, useLoaderData, useRouteLoaderData, Link} from 'react-router';
import {Image} from '@shopify/hydrogen';

import type {Route} from './+types/_index';
import type {
  FeaturedCollectionFragment,
  RecommendedProductsQuery,
} from 'storefrontapi.generated';
import {ProductItem} from '~/components/ProductItem';
import {MockShopNotice} from '~/components/MockShopNotice';
import {T} from 'gt-react';

import type {RootLoader} from '~/root';

export const meta: Route.MetaFunction = () => [{title: 'GT Supply'}];

export async function loader(args: Route.LoaderArgs) {
  const deferredData = loadDeferredData(args);
  const criticalData = await loadCriticalData(args);
  return {...deferredData, ...criticalData};
}

async function loadCriticalData({context}: Route.LoaderArgs) {
  const {collections} = await context.storefront.query(FEATURED_COLLECTION_QUERY);
  return {featuredCollection: collections.nodes[0] ?? null};
}

function loadDeferredData({context}: Route.LoaderArgs) {
  const recommendedProducts = context.storefront
    .query(RECOMMENDED_PRODUCTS_QUERY)
    .catch((error: Error) => {
      console.error(error);
      return null;
    });
  return {recommendedProducts};
}

export default function Homepage() {
  const data = useLoaderData<typeof loader>();
  const rootData = useRouteLoaderData<RootLoader>('root');
  return (
    <div className="home">
      {rootData?.isDemoStore ? <MockShopNotice /> : null}
      <FeaturedCollection collection={data.featuredCollection} />
      <RecommendedProducts products={data.recommendedProducts} />
      <T>
        <section className="everyday-note">
          <p className="eyebrow">Less fuss. More living.</p>
          <h2>Find your everyday.</h2>
          <p>Simple pieces that make getting dressed feel effortless.</p>
        </section>
      </T>
    </div>
  );
}

function FeaturedCollection({collection}: {collection: FeaturedCollectionFragment | null}) {

  const image = collection?.image ?? collection?.products.nodes[0]?.featuredImage;
  return (
    <section className="store-hero" aria-labelledby="hero-title">
      <T>
        <div className="hero-copy">
          <p className="eyebrow">Everyday essentials</p>
          <h1 id="hero-title">Good things,<br />worn often.</h1>
          <p className="hero-description">Easy layers. Familiar favorites. Find your everyday uniform.</p>
          <Link className="button-primary" to={'/collections/all'} prefetch="intent">
            Explore the collection<span aria-hidden="true">↗</span>
          </Link>
          <p className="hero-footnote">Your next favorite is right here.</p>
        </div>
      </T>
      <div className="hero-image">
        {image ? (
          <Image
            data={image}
            sizes="(min-width: 900px) 60vw, 100vw"
            alt={image.altText || collection?.title || ''}
            loading="eager"
          />
        ) : null}
        {collection ? (
          <Link className="hero-collection-link" to={`/collections/${collection.handle}`}>
            <span>{collection.title}</span><span aria-hidden="true">↗</span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function RecommendedProducts({products}: {products: Promise<RecommendedProductsQuery | null>}) {

  return (
    <section className="recommended-products" aria-labelledby="recommended-products">
      <T>
        <div className="section-heading">
          <div>
            <p className="eyebrow">On the shortlist</p>
            <h2 id="recommended-products">The everyday edit</h2>
          </div>
          <Link className="text-link" to={'/collections/all'}>
            Shop all<span aria-hidden="true">↗</span>
          </Link>
        </div>
      </T>
      <Suspense fallback={<T><div className="products-loading">Finding your next favorites…</div></T>}>
        <Await resolve={products}>
          {(response) => response ? (
            <div className="recommended-products-grid">
              {response.products.nodes.map((product) => <ProductItem key={product.id} product={product} />)}
            </div>
          ) : <T><p>We could not load the collection. Please try again.</p></T>}
        </Await>
      </Suspense>
    </section>
  );
}

const FEATURED_COLLECTION_QUERY = `#graphql
  fragment FeaturedCollection on Collection {
    id
    title
    image {
      id
      url
      altText
      width
      height
    }
    products(first: 1) {
      nodes {
        featuredImage {
          id
          url
          altText
          width
          height
        }
      }
    }
    handle
  }
  query FeaturedCollection($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    collections(first: 1, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...FeaturedCollection
      }
    }
  }
` as const;

const RECOMMENDED_PRODUCTS_QUERY = `#graphql
  fragment RecommendedProduct on Product {
    id
    title
    handle
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    featuredImage {
      id
      url
      altText
      width
      height
    }
  }
  query RecommendedProducts ($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    products(first: 4, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...RecommendedProduct
      }
    }
  }
` as const;
