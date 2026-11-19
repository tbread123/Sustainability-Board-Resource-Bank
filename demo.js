const demoApi = (() => {
  const key = 'susbo-resource-desk-demo-v1:' + location.pathname.replace(/index\.html$/, '');
  const date = (offset = 0) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + offset * 86400000));
  const now = () => new Date().toISOString();
  const requireDemo = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
  const id = () => crypto.randomUUID();
  const mark = (store, request, kind, note = '') => {
    const resource = store.resources.find(row => row.id === request.resource_id);
    store.events.unshift({
      ...request, name: resource.name, request_code: request.code, kind, note, created: now(),
    });
  };
  const movement = (store, resource, kind, quantity, note) => store.movements.unshift({
    id: id().slice(0, 8), resource_name: resource.name, kind, quantity, note, created: now(),
  });

  function seed() {
    const resources = [
      ['Wireless microphone', 'Media Club', 'Media Room', 6, 'returnable', 'mic mike microphone', 'units'],
      ['Projector', 'Film Club', 'Equipment Room', 3, 'returnable', 'beamer', 'units'],
      ['Extension cord', 'Robotics Club', 'Workshop', 10, 'returnable', 'extention cord power strip', 'units'],
      ['Tripod', 'Media Club', 'Media Room', 5, 'returnable', '三脚架 三腳架', 'units'],
      ['Poster board', 'Art Club', 'Art Studio', 30, 'consumable', 'cardboard', 'sheets'],
      ['Folding display stand', 'Art Club', 'Art Studio', 4, 'unclassified', 'easel', 'units'],
    ].map(([name, club, location, total, usage, aliases, unit], index) => ({
      id: 'DEMO-' + (index + 1), name, original_name: name, club, location, total, usage, aliases, unit,
    }));
    const requests = [
      {code: 'DEMO17', resource_id: 'DEMO-2', borrower: 'Sample Student A', club: 'Film Club',
        event: 'Film screening', quantity: 1, due: date(7), status: 'pending'},
      {code: 'DEMO42', resource_id: 'DEMO-1', borrower: 'Sample Student B', club: 'Drama Club',
        event: 'Stage rehearsal', quantity: 2, due: date(-1), status: 'collected', outstanding: 2},
    ].map(request => ({created: now(), decision_note: '', outstanding: 0, ...request}));
    const store = {resources, requests, reports: [], stock_reports: [], events: [], movements: []};
    requests.forEach(request => mark(store, request, 'Request submitted'));
    mark(store, requests[1], 'Collection confirmed');
    return store;
  }

  function stock(store, resource) {
    const requests = store.requests.filter(row => row.resource_id === resource.id);
    const reserved = sum(requests.filter(row => row.status === 'approved'), 'quantity');
    const outstanding = sum(requests, 'outstanding');
    return {...resource, reserved, outstanding, available: resource.total - reserved - outstanding};
  }

  function catalogue(store, query) {
    const terms = query.trim().toLowerCase().split(/\s+/);
    return store.resources.map(resource => stock(store, resource)).filter(resource => {
      const searchable = [resource.name, resource.club, resource.location, resource.aliases].join(' ').toLowerCase();
      return terms.every(term => searchable.includes(term));
    });
  }

  function snapshot(store, query) {
    const details = row => {
      const resource = store.resources.find(item => item.id === row.resource_id);
      return {...row, name: resource.name, owner_club: resource.club, location: resource.location};
    };
    const requests = store.requests.map(details);
    return {
      resources: catalogue(store, query), requests, events: store.events, movements: store.movements,
      loans: requests.filter(row => row.status === 'collected').map(row => ({
        ...row, request_code: row.code, status: row.outstanding && row.due < date() ? 'Overdue' : 'Current',
      })),
      reports: store.reports.map(row => {
        const request = requests.find(item => item.code === row.request_code);
        return {...row, name: request.name, borrower: request.borrower, club: request.club};
      }),
      stock_reports: store.stock_reports.map(details),
    };
  }

  return function dispatch(path, data = {}) {
    const url = new URL(path, location.href);
    const route = url.pathname.slice('/api/'.length);
    if (route === 'login' || route === 'logout') {
      sessionStorage.setItem(key, route === 'login' ? 'admin' : '');
      return {};
    }
    const admin = sessionStorage.getItem(key) === 'admin';
    if (route === 'session') return {admin};
    if (['state', 'decision', 'collect', 'review-return', 'configure', 'review-stock'].includes(route)) {
      requireDemo(admin, 'Open the admin demo first.');
    }

    const store = JSON.parse(localStorage.getItem(key)) ?? seed();
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(store));
    const query = url.searchParams.get('q') ?? '';
    if (route === 'state') return snapshot(store, query);
    if (route === 'catalogue') return {resources: catalogue(store, query)};

    const request = store.requests.find(row => row.code === data.code);
    const resource = store.resources.find(row => row.id === (request?.resource_id ?? data.resource_id));
    const report = store.reports.find(row => row.id === data.report_id);
    const change = store.stock_reports.find(row => row.id === data.report_id);
    const {quantity, decision} = data;
    const note = data.note?.trim() ?? '';
    const save = (message, code) => {
      localStorage.setItem(key, JSON.stringify(store));
      return {message, code};
    };

    switch (route) {
      case 'request': {
        requireDemo(resource && Number.isInteger(quantity) && quantity > 0 && quantity <= resource.total,
          'Choose a quantity within the total stock count.');
        requireDemo(data.borrower.trim() && data.club.trim() && data.event.trim(), 'Complete all request fields.');
        requireDemo(data.due && data.due >= date(), 'Expected return date cannot be in the past.');
        let code;
        do {
          code = id().slice(0, 6).toUpperCase();
        } while (store.requests.some(row => row.code === code));
        const row = {...data, code, created: now(), status: 'pending', decision_note: '', outstanding: 0};
        store.requests.unshift(row);
        mark(store, row, 'Request submitted');
        return save('Request submitted. Save code ' + code + ' to check status or report a return.', code);
      }
      case 'lookup':
      case 'report-return': {
        requireDemo(request, 'Code not found. Try sample code DEMO42 or enter your own request code.');
        const pending = sum(store.reports.filter(row => row.request_code === request.code && row.status === 'pending'), 'quantity');
        const reportable = request.outstanding - pending;
        const can_return = request.status === 'collected' && reportable > 0;
        if (route === 'lookup') {
          let return_message = 'Returns are available after approval and collection.';
          if (request.status === 'denied') return_message = 'The request was denied.';
          if (request.status === 'collected') {
            if (resource.usage === 'consumable') return_message = 'Consumables do not need to be returned.';
            else if (!request.outstanding) return_message = 'All items have been returned.';
            else if (!can_return) return_message = 'Your return is awaiting verification.';
            else return_message = 'Choose Return items to submit the quantity and condition.';
          }
          return {...request, name: resource.name, can_return, reportable, pending_returns: pending, return_message};
        }
        requireDemo(can_return && Number.isInteger(quantity) && quantity > 0 && quantity <= reportable,
          'Choose a quantity within the available return balance.');
        requireDemo(note, 'Enter the return condition.');
        store.reports.unshift({id: id(), request_code: request.code, quantity, note, status: 'pending', created: now()});
        mark(store, request, 'Return reported', quantity + ' reported. ' + note);
        return save('Return reported. Susbo verification is pending.');
      }
      case 'decision':
        requireDemo(request?.status === 'pending' && note, 'Choose a pending request and enter a decision note.');
        if (decision === 'approved') {
          requireDemo(resource.usage !== 'unclassified', 'Set a usage rule before approval.');
          requireDemo(request.due >= date(), 'The expected return date has passed.');
          requireDemo(stock(store, resource).available >= request.quantity, 'Insufficient unreserved stock.');
        }
        request.status = decision;
        request.decision_note = note;
        mark(store, request, 'Request ' + decision, note);
        return save('Request ' + decision + '.');
      case 'collect':
        requireDemo(request?.status === 'approved', 'Choose an approved request.');
        request.status = 'collected';
        if (resource.usage === 'returnable') request.outstanding = request.quantity;
        else resource.total -= request.quantity;
        mark(store, request, 'Collection confirmed');
        return save('Collection confirmed.');
      case 'review-return': {
        requireDemo(report?.status === 'pending' && note, 'Choose a pending return and enter a review note.');
        const row = store.requests.find(item => item.code === report.request_code);
        if (decision === 'verified') row.outstanding -= report.quantity;
        report.status = decision;
        mark(store, row, 'Return ' + decision, note);
        return save('Return ' + decision + '.');
      }
      case 'configure': {
        requireDemo(resource, 'Resource not found.');
        const counts = stock(store, resource);
        requireDemo(Number.isInteger(data.total) && data.total >= counts.reserved + counts.outstanding,
          'Stock must cover all reservations and outstanding items.');
        requireDemo(data.unit.trim() && ['returnable', 'consumable'].includes(data.usage), 'Enter a unit and usage rule.');
        requireDemo(data.usage === resource.usage || !store.requests.some(row =>
          row.resource_id === resource.id && ['approved', 'collected'].includes(row.status)),
          'This resource already has reservations or collection history.');
        Object.assign(resource, {total: data.total, unit: data.unit.trim(), usage: data.usage});
        movement(store, resource, 'Stock configured', data.total, '');
        return save('Stock and usage rule saved.');
      }
      case 'report-stock':
        requireDemo(resource && resource.usage !== 'consumable', 'Choose a returnable resource.');
        requireDemo(Number.isInteger(data.delta) && data.delta && Math.abs(data.delta) <= 100000,
          'Enter a non-zero stock change up to 100,000 items.');
        requireDemo(data.reporter.trim() && data.club.trim() && data.reason.trim(), 'Complete all report fields.');
        store.stock_reports.unshift({...data, id: id().slice(0, 8), status: 'pending', created: now()});
        movement(store, resource, 'Stock change reported', data.delta, data.reason);
        return save('Stock change reported. Susbo approval is pending.');
      case 'review-stock': {
        requireDemo(change?.status === 'pending' && note, 'Choose a pending stock report and enter a review note.');
        const item = store.resources.find(row => row.id === change.resource_id);
        if (decision === 'approved') {
          requireDemo(item.usage !== 'consumable', 'Stock reports apply only to returnable resources.');
          requireDemo(stock(store, item).available + change.delta >= 0, 'Stock must cover reservations and outstanding items.');
          item.total += change.delta;
          item.usage = 'returnable';
        }
        change.status = decision;
        movement(store, item, 'Stock change ' + decision, change.delta, note);
        return save('Stock change ' + decision + '.');
      }
      default:
        throw new Error('Unknown demo action.');
    }
  };
})();
