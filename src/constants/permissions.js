export const ACTIONS = {
    CREATE_TRANSACTION: "create_transaction",
    READ_TRANSACTION: "read_transaction",
    UPDATE_TRANSACTION: "update_transaction",
    DELETE_TRANSACTION: "delete_transaction",
    VIEW_DASHBOARD: "view_dashboard",
    CREATE_ACCOUNT: "create_account",
};

export const ROLE_PERMISSIONS = {
    admin: [
        ACTIONS.CREATE_TRANSACTION,
        ACTIONS.READ_TRANSACTION,
        ACTIONS.UPDATE_TRANSACTION,
        ACTIONS.DELETE_TRANSACTION,
        ACTIONS.VIEW_DASHBOARD,
        ACTIONS.CREATE_ACCOUNT,
    ],
    analyst: [
        ACTIONS.READ_TRANSACTION, 
        ACTIONS.VIEW_DASHBOARD
    ],
    viewer: [
        ACTIONS.VIEW_DASHBOARD
    ],
};
