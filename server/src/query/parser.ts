import {Field} from '../../../type';
import P, {Language, Parser} from 'parsimmon';
import semver from 'semver';
import {expectNever, ffVersionRegex} from '../util/util';

const whitespace = P.regexp(/\s*/m);
function token(parser) {
    return parser.skip(whitespace);
}
function word(str) {
    return P.string(str).thru(token);
}

export type SingleExpression = {
    field: string;
    op: Operator;
    value: unknown;
};

export type Operator = '=' | '<=' | '>=' | '!=' | '<' | '>' | '~' | '~~';

export type Expression = SingleExpression | [Expression, 'or' | 'and', Expression];

export const createParser = (fields: Field[]): Parser<Expression>['parse'] => {
    const rules: any = {};
    fields.forEach((field) => {
        const create = (r: Language, op: Parser<any>, value: Parser<any>) => {
            return P.seqObj<any>(['field', word(field.name)], ['op', op], ['value', value]);
        };
        switch (field.type) {
            case 'boolean':
                rules['field' + field.name] = (r: Language) => create(r, r.boolOp, P.alt(r.true, r.false));
                break;
            case 'string':
                const values = (r: Language) => (field.enum !== undefined ? P.alt(...field.enum.map(word)) : r.string);
                rules['field' + field.name] = (r: Language) => create(r, r.stringOp, values(r));
                break;
            case 'number':
                rules['field' + field.name] = (r: Language) => create(r, r.orderedOp, r.number);
                break;
            case 'date':
                rules['field' + field.name] = (r: Language) => create(r, r.orderedOp, r.date);
                break;
            case 'semver':
                rules['field' + field.name] = (r: Language) => create(r, r.orderedOp, r.semver);
                break;
            case 'ffversion':
                rules['field' + field.name] = (r: Language) => create(r, r.orderedOp, r.ffversion);
                break;
            default:
                expectNever(field.type);
        }
    });

    const expression = P.createLanguage({
        ...rules,
        orderedOp: (r) => P.alt(r.gte, r.lte, r.lt, r.gt, r.neq, r.eq).thru((parser) => whitespace.then(parser)),
        boolOp: (r) => P.alt(r.neq, r.eq).thru((parser) => whitespace.then(parser)),
        stringOp: (r) => P.alt(r.eq, r.neq, r.fuzzy, r.contains).thru((p) => whitespace.then(p)),
        lbrace: () => word('('),
        rbrace: () => word(')'),
        eq: () => word('='),
        neq: () => word('!='),
        contains: () => word('~'),
        fuzzy: () => word('~~'),
        lte: () => word('<='),
        lt: () => word('<'),
        gte: () => word('>='),
        gt: () => word('>'),
        or: () => word('or'),
        and: () => word('and'),
        ffversion: () => P.regex(ffVersionRegex).desc('ffversion format: 1.0.0-1'),
        semver: () => P.regex(/\d+\.?(\d+)?\.?(\d+)?-?([\w.-]+)?/).desc('semver'),
        date: () =>
            P.regex(/\d{4}-\d{2}-\d{2}/)
                .desc('date YYYY-MM-DD')
                .map(Date.parse),
        true: () => word('true').result(true),
        false: () => word('false').result(false),
        stringWithoutWhiteSpace: () => P.regex(/([\w-\\/A,]*)/, 1).desc('string'),
        stringWhiteSpace: () => P.regex(/["']([^'"]*)['"]/, 1).desc('string'),
        string: (r) => P.alt(r.stringWhiteSpace, r.stringWithoutWhiteSpace),

        number: () =>
            token(P.regexp(/-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?/))
                .map(Number)
                .desc('number'),

        singleExpression: (r) => P.alt(...fields.map(({name}) => r['field' + name])),
        orOrAnd: (r) => P.alt(r.or, r.and).thru((x) => whitespace.then(x)),
        orAndExpression: (r) =>
            P.seq(P.alt(r.braceExpression, r.singleExpression), r.orOrAnd, P.alt(r.braceExpression, r.orAndExpression, r.singleExpression)),
        braceExpression: (r) => P.seqMap(r.lbrace, P.alt(r.expression), r.rbrace, (_1, e) => e),
        expression: (r) => P.alt(r.orAndExpression, r.braceExpression, r.singleExpression),
    }).expression;
    return (s) => expression.parse(s);
};
