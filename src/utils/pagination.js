function getPagination(query) {
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function buildPaginatedQuery(baseQuery, countQuery, params, offset, limit) {
  return {
    dataQuery: `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    countQuery,
    dataParams: [...params, limit, offset],
    countParams: params,
  };
}

module.exports = { getPagination, buildPaginatedQuery };
