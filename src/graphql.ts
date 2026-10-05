import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client/core'
import { backend } from './versioning/backend'

export const SCHEME_QUERY = gql`
  query SchemeOverview {
    scheme { id project area version }
    reviewStats { pending accepted returned }
    agencies { id name role }
  }
`

const AGENCIES = [
  { __typename: 'Agency', id: 'AG-1', name: '市政建设集团', role: '建设' },
  { __typename: 'Agency', id: 'AG-2', name: '市交警支队', role: '交通' },
  { __typename: 'Agency', id: 'AG-3', name: '公交集团', role: '公交' },
  { __typename: 'Agency', id: 'AG-4', name: '急救中心', role: '应急' },
]

const mockLink = new ApolloLink((operation) => new Observable((observer) => {
  setTimeout(() => {
    if (operation.operationName === 'SchemeOverview') {
      const { meta, version, current } = backend.state
      observer.next({
        data: {
          scheme: { __typename: 'Scheme', id: meta.id, project: meta.project, area: meta.area, version },
          reviewStats: {
            __typename: 'ReviewStats',
            pending: current.comments.filter((item) => item.status === '待处理').length,
            accepted: current.comments.filter((item) => item.status === '已接受').length,
            returned: current.comments.filter((item) => item.status === '已退回').length,
          },
          agencies: AGENCIES,
        },
      })
    } else {
      observer.next({ data: {} })
    }
    observer.complete()
  }, 180)
}))

export const apolloClient = new ApolloClient({ cache: new InMemoryCache(), link: mockLink })
