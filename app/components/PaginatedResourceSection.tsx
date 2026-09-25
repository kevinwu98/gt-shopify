import * as React from 'react';
import {Pagination} from '@shopify/hydrogen';
import {T, Branch} from 'gt-react';

/**
 * <PaginatedResourceSection> encapsulates the previous and next pagination behaviors throughout your application.
 */
export function PaginatedResourceSection<NodesType>({
  connection,
  children,
  ariaLabel,
  resourcesClassName,
}: {
  connection: React.ComponentProps<typeof Pagination<NodesType>>['connection'];
  children: React.FunctionComponent<{node: NodesType; index: number}>;
  ariaLabel?: string;
  resourcesClassName?: string;
}) {
  return (
    <Pagination connection={connection}>
      {({nodes, isLoading, PreviousLink, NextLink}) => {
        const resourcesMarkup = nodes.map((node, index) =>
          children({node, index}),
        );

        return (
          <div>
            <T>
              <PreviousLink>
                <Branch
                  branch={isLoading.toString()}
                  true={<>Loading…</>}
                  false={
                    <span>
                      <span aria-hidden="true">↑</span> Load previous
                    </span>
                  }
                />
              </PreviousLink>
            </T>
            {resourcesClassName ? (
              <div
                aria-label={ariaLabel}
                className={resourcesClassName}
                role={ariaLabel ? 'region' : undefined}
              >
                {resourcesMarkup}
              </div>
            ) : (
              resourcesMarkup
            )}
            <T>
              <NextLink>
                <Branch
                  branch={isLoading.toString()}
                  true={<>Loading…</>}
                  false={
                    <span>
                      Load more <span aria-hidden="true">↓</span>
                    </span>
                  }
                />
              </NextLink>
            </T>
          </div>
        );
      }}
    </Pagination>
  );
}
